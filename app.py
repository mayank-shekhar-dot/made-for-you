        socketio.emit("presence", {"user": user, "online": False, "last_seen": seen},
                      to=OTHER[user])
        socketio.emit("typing", {"user": user, "typing": False}, to=OTHER[user])


@socketio.on("visible")
def on_visible(data):
    user = current_user()
    if not user:
        return
    if (data or {}).get("visible"):
        viewing[user].add(request.sid)
    else:
        viewing[user].discard(request.sid)


@socketio.on("send_message")
def on_send(data):
    user = current_user()
    if not user:
        return {"ok": False, "error": "Not logged in"}
    body = (data or {}).get("body")
    if not isinstance(body, str) or not body.strip():
        return {"ok": False, "error": "Empty message"}
    body = body.strip()
    if len(body) > 2000:
        return {"ok": False, "error": "Message is too long"}
    create_message(user, body, None)
    return {"ok": True}


@socketio.on("edit_message")
def on_edit(data):
    user = current_user()
    if not user:
        return {"ok": False, "error": "Not logged in"}
    try:
        mid = int((data or {}).get("id"))
    except (TypeError, ValueError):
        return {"ok": False, "error": "Invalid message"}
    body = (data or {}).get("body")
    row = query("SELECT sender FROM messages WHERE id=?", (mid,), one=True)
    if not row or row["sender"] != user:
        return {"ok": False, "error": "Sirf apna message edit kar sakte ho."}
    if not isinstance(body, str) or not body.strip() or len(body.strip()) > 2000:
        return {"ok": False, "error": "Message khali ya bahut lamba hai."}
    at = now_iso()
    execute("UPDATE messages SET body=?, edited_at=? WHERE id=?", (body.strip(), at, mid))
    payload = {"id": mid, "body": body.strip(), "edited_at": at}
    for u in USERS:
        socketio.emit("message_edited", payload, to=u)
    return {"ok": True}


@socketio.on("react")
def on_react(data):
    user = current_user()
    if not user:
        return
    try:
        mid = int((data or {}).get("id"))
    except (TypeError, ValueError):
        return
    emoji = (data or {}).get("emoji")
    if not query("SELECT 1 FROM messages WHERE id=?", (mid,), one=True):
        return
    cur = query("SELECT emoji FROM reactions WHERE message_id=? AND user=?", (mid, user), one=True)
    if emoji is None or (cur and cur["emoji"] == emoji):
        execute("DELETE FROM reactions WHERE message_id=? AND user=?", (mid, user))
    elif emoji in REACTIONS:
        execute("INSERT INTO reactions(message_id, user, emoji) VALUES(?,?,?) "
                "ON CONFLICT(message_id, user) DO UPDATE SET emoji=excluded.emoji", (mid, user, emoji))
    else:
        return
    payload = {"id": mid, "reactions": get_reactions(mid)}
    for u in USERS:
        socketio.emit("reactions", payload, to=u)


@socketio.on("typing")
def on_typing(data):
    user = current_user()
    if user:
        socketio.emit("typing", {"user": user, "typing": bool((data or {}).get("typing"))},
                      to=OTHER[user])


@socketio.on("mark_read")
def on_read():
    user = current_user()
    if not user:
        return
    ids = [r["id"] for r in query(
        "SELECT id FROM messages WHERE recipient=? AND read_at IS NULL", (user,))]
    if ids:
        at = now_iso()
        execute("UPDATE messages SET read_at=?, delivered_at=COALESCE(delivered_at, ?) "
                "WHERE recipient=? AND read_at IS NULL", (at, at, user))
        socketio.emit("read", {"ids": ids, "at": at}, to=OTHER[user])


def setup_passwords(force=False):
    import getpass
    for name in USERS:
        exists = query("SELECT 1 FROM users WHERE name=?", (name,), one=True)
        if exists and not force:
            continue
        while True:
            pw = getpass.getpass(f"Choose a password for {name} (min 8 chars): ")
            if len(pw) < 8:
                print("  Too short, try again.")
            elif pw != getpass.getpass("  Confirm: "):
                print("  Did not match, try again.")
            else:
                set_password(name, pw)
                print(f"  {name} saved.")
                break


if __name__ == "__main__":
    import sys
    # first run: asks for the two passwords; "python app.py setpw" resets them
    if len(sys.argv) > 1 and sys.argv[1] == "setpw":
        setup_passwords(force=True)
    else:
        # ready-made password for both accounts: 2011  (change it before going online!)
        for _name in USERS:
            if not query("SELECT 1 FROM users WHERE name=?", (_name,), one=True):
