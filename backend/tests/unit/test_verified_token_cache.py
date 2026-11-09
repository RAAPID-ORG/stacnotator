import time

from src.auth.providers.firebase import _VerifiedTokenCache

USER = {"uid": "abc", "email": "a@example.com"}
OTHER = {"uid": "def", "email": "d@example.com"}


def _future(seconds: float = 60) -> float:
    return time.time() + seconds


def test_a_verified_token_is_returned_without_reverifying():
    """The whole point: a viewport's worth of requests carry one token."""
    cache = _VerifiedTokenCache()
    cache.put("tok", USER, expires_at=_future())
    assert cache.get("tok") == USER


def test_an_unknown_token_is_a_miss():
    assert _VerifiedTokenCache().get("never-seen") is None


def test_an_entry_is_never_honoured_past_the_token_expiry():
    """A cache hit must not outlive the credential the client is holding."""
    cache = _VerifiedTokenCache()
    cache.put("tok", USER, expires_at=time.time() - 1)
    assert cache.get("tok") is None


def test_a_token_without_an_expiry_claim_is_not_cached():
    """Without `exp` there is no bound on how long a hit would stay valid."""
    cache = _VerifiedTokenCache()
    cache.put("tok", USER, expires_at=None)
    assert cache.get("tok") is None


def test_tokens_do_not_share_entries():
    cache = _VerifiedTokenCache()
    cache.put("one", USER, expires_at=_future())
    cache.put("two", OTHER, expires_at=_future())
    assert cache.get("one") == USER
    assert cache.get("two") == OTHER


def test_the_cache_is_bounded_so_distinct_tokens_cannot_grow_it_forever():
    """Every request could carry a different token; memory must not track that."""
    cache = _VerifiedTokenCache(max_entries=3)
    for i in range(10):
        cache.put(f"tok-{i}", USER, expires_at=_future())
    assert len(cache._entries) == 3
    # Eviction is least-recently-used, so the newest survive.
    assert cache.get("tok-9") == USER
    assert cache.get("tok-0") is None


def test_reading_an_entry_protects_it_from_eviction():
    """An actively-used token is the one worth keeping when space runs out."""
    cache = _VerifiedTokenCache(max_entries=2)
    cache.put("old", USER, expires_at=_future())
    cache.put("new", OTHER, expires_at=_future())
    cache.get("old")
    cache.put("newest", USER, expires_at=_future())
    assert cache.get("old") == USER
    assert cache.get("new") is None


def test_an_expired_entry_is_dropped_rather_than_left_to_accumulate():
    cache = _VerifiedTokenCache()
    cache.put("tok", USER, expires_at=time.time() - 1)
    cache.get("tok")
    assert "tok" not in cache._entries
