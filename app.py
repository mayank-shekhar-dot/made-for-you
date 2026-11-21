"""Arpita & Mayank Love ♡ — run:  pip install flask flask-socketio simple-websocket pillow  then  python app.py  (for phone notifications also: pip install pywebpush)"""
import os
import re
import json
import threading
import base64
import sqlite3
import secrets
import uuid
import time
from contextlib import closing
from datetime import datetime, timezone
from functools import wraps

from flask import (Flask, g, request, session, jsonify, send_from_directory,
                   redirect)
from flask_socketio import SocketIO, emit, join_room
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from werkzeug.middleware.proxy_fix import ProxyFix
from PIL import Image, ImageOps

# ----------------------------------------------------------------- config
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("DATA_DIR", os.path.join(BASE_DIR, "data"))
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
DB_PATH = os.path.join(DATA_DIR, "love.db")
os.makedirs(UPLOAD_DIR, exist_ok=True)

USERS = ["Arpita", "Mayank"]
DEFAULT_PASSWORD = "2011"
OTHER = {"Arpita": "Mayank", "Mayank": "Arpita"}
PRODUCTION = os.environ.get("PRODUCTION") == "1"
ALLOWED_FORMATS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp", "GIF": "gif"}
REACTIONS = ["❤️", "😂", "😮", "😢", "👍", "🙏", "🔥", "🥰"]
IMG_MAX = 10 * 1024 * 1024
AUDIO_MAX = 10 * 1024 * 1024
VIDEO_MAX = 50 * 1024 * 1024


def load_secret_key():
    key = os.environ.get("SECRET_KEY")
    if key:
        return key
    path = os.path.join(DATA_DIR, "secret_key")
    if os.path.exists(path):
        with open(path) as f:
            return f.read().strip()
    key = secrets.token_hex(32)
    with open(path, "w") as f:
        f.write(key)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return key


app = Flask(__name__)
app.config.update(
    SECRET_KEY=load_secret_key(),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=PRODUCTION,
    PERMANENT_SESSION_LIFETIME=60 * 60 * 24 * 30,
    MAX_CONTENT_LENGTH=64 * 1024 * 1024,
)
if PRODUCTION:  # running behind a hosting proxy that terminates HTTPS
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

origins = os.environ.get("ALLOWED_ORIGINS")
socketio = SocketIO(
    app,
    async_mode="threading",
    cors_allowed_origins=[o.strip() for o in origins.split(",")] if origins else None,
)

online = {u: set() for u in USERS}   # username -> socket ids (connected)
viewing = {u: set() for u in USERS}  # username -> socket ids whose page is visible right now

# ---- push notifications (Android Chrome etc.) ----
try:
    from pywebpush import webpush, WebPushException
    from py_vapid import Vapid
    from cryptography.hazmat.primitives import serialization
    PUSH_OK = True
except Exception:
    PUSH_OK = False
VAPID_SUB = os.environ.get("VAPID_EMAIL", "mailto:admin@example.com")
NOTIFY_USERS = {"Mayank"}  # only these people get phone notifications
SHOW_PREVIEW = False  # True = lock screen shows the message text; False = only "new message"


def load_vapid():
    env = os.environ.get("VAPID_PRIVATE_KEY")
    if env:
