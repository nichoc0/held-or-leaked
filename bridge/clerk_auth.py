"""
Clerk session-token verification for the relay (the security gate before public
exposure). Verifies the frontend's Clerk session JWT against Clerk's JWKS and
gates to admins only — so relay.pistonsolutions.ai can't leak transcripts to
anyone with the URL.

Config (env, e.g. bridge/.env):
  REQUIRE_AUTH=1                 # fail-closed; unset = open (LOCAL DEV ONLY)
  CLERK_SECRET_KEY=sk_live_...   # backend key, fetches JWKS from api.clerk.com
  ADMIN_ORG_ID=org_...           # admin = member of this Clerk org  (preferred)
  ADMIN_USER_IDS=user_a,user_b   # OR an explicit Clerk user-id allowlist
"""
from __future__ import annotations
import os, time, urllib.request, json
import jwt
from jwt import PyJWKClient
from fastapi import HTTPException

REQUIRE_AUTH = os.environ.get("REQUIRE_AUTH") == "1"
CLERK_SECRET = os.environ.get("CLERK_SECRET_KEY", "")
ADMIN_ORG_ID = os.environ.get("ADMIN_ORG_ID", "")
ADMIN_USER_IDS = {u.strip() for u in os.environ.get("ADMIN_USER_IDS", "").split(",") if u.strip()}
JWKS_URL = "https://api.clerk.com/v1/jwks"

_jwks_client = None
_jwks_ts = 0

def _client():
    """Cached PyJWKClient pointed at Clerk's backend JWKS (needs the secret key)."""
    global _jwks_client, _jwks_ts
    if _jwks_client and (time.time() - _jwks_ts) < 3600:
        return _jwks_client
    if not CLERK_SECRET:
        raise HTTPException(500, "relay auth misconfigured: CLERK_SECRET_KEY not set")
    # PyJWKClient can't send auth headers, so fetch the JWKS ourselves and hand it in
    req = urllib.request.Request(JWKS_URL, headers={"Authorization": f"Bearer {CLERK_SECRET}"})
    data = json.loads(urllib.request.urlopen(req, timeout=8).read())
    from jwt import PyJWKSet
    _jwks_client = PyJWKSet.from_dict(data)
    _jwks_ts = time.time()
    return _jwks_client

def verify(token: str) -> dict:
    """Verify a Clerk session JWT; return claims or raise 401."""
    try:
        jwks = _client()
        header = jwt.get_unverified_header(token)
        key = next(k for k in jwks.keys if k.key_id == header["kid"])
        claims = jwt.decode(token, key.key, algorithms=["RS256"],
                            options={"verify_aud": False, "leeway": 10})
        return claims
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(401, f"invalid session token: {type(e).__name__}")

def is_admin(claims: dict) -> bool:
    if ADMIN_USER_IDS and claims.get("sub") in ADMIN_USER_IDS:
        return True
    if ADMIN_ORG_ID:
        # Clerk session tokens carry the active org as `org_id` or nested `o.id`
        oid = claims.get("org_id") or (claims.get("o") or {}).get("id")
        return oid == ADMIN_ORG_ID
    return False

def require_admin(token: str | None) -> dict:
    """Gate an admin-only request. Fail-open only when REQUIRE_AUTH is unset (dev)."""
    if not REQUIRE_AUTH:
        return {"dev": True}
    if not token:
        raise HTTPException(401, "missing session token")
    token = token.replace("Bearer ", "").strip()
    claims = verify(token)
    if not is_admin(claims):
        raise HTTPException(403, "admin access required")
    return claims
