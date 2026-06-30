"""
Key server for Module 2A — Zero-Trust Video Streaming.

Endpoints:
  POST /token  — Issue a short-lived JWT to an authenticated client.
                 (Demo auth: fixed credentials. Replace with real auth in production.)
  GET  /key    — Serve the AES-128 decryption key ONLY if the request carries
                 a valid, unexpired JWT. Returns 403 on any failure.
  GET  /health — Liveness check.
"""

import os
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import FastAPI, Header, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from jose import JWTError, jwt
from pydantic import BaseModel

app = FastAPI(title="Polycode Key Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in production
    allow_methods=["*"],
    allow_headers=["*"],
)

JWT_SECRET: str = os.environ.get("JWT_SECRET", "polycode-demo-secret-change-in-production")
JWT_ALGORITHM = "HS256"
TOKEN_TTL_SECONDS = 300  # 5 minutes

# AES-128 key — must be the same 16-byte value used to encrypt the HLS segments.
AES_KEY_HEX: str = os.environ.get("AES_KEY_HEX", "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6")
AES_KEY_BYTES: bytes = bytes.fromhex(AES_KEY_HEX)

# Stand-in demo credentials — replace with real authentication in production.
DEMO_USERNAME = "demo"
DEMO_PASSWORD = "polycode2024"


class LoginRequest(BaseModel):
    username: str
    password: str


@app.post("/token")
def issue_token(body: LoginRequest):
    """Issue a short-lived JWT. Uses fixed demo credentials — stand-in for real auth."""
    if body.username != DEMO_USERNAME or body.password != DEMO_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    now = datetime.now(timezone.utc)
    payload = {
        "sub": body.username,
        "iat": now,
        "exp": now + timedelta(seconds=TOKEN_TTL_SECONDS),
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": TOKEN_TTL_SECONDS,
    }


def _require_valid_token(authorization: Optional[str] = Header(default=None)) -> dict:
    """FastAPI dependency — validates Bearer token, raises 403 on any failure."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=403, detail="Missing or malformed Authorization header")
    token = authorization.removeprefix("Bearer ")
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError as exc:
        raise HTTPException(status_code=403, detail=f"Invalid or expired token: {exc}")


@app.get("/key")
def serve_key(_claims: dict = Depends(_require_valid_token)):
    """
    Serve the raw AES-128 decryption key (16 bytes, application/octet-stream).
    Requires a valid, unexpired Bearer token — 403 without one.
    This is the endpoint referenced by EXT-X-KEY in the HLS playlist.
    """
    return Response(content=AES_KEY_BYTES, media_type="application/octet-stream")


@app.get("/health")
def health():
    return {"status": "ok"}
