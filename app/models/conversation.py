"""Simple in-memory conversation store keyed by phone number + client slug."""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime

MAX_HISTORY = 20  # messages per conversation before trimming


@dataclass
class Message:
    role: str  # "user" | "assistant"
    content: str
    ts: datetime = field(default_factory=datetime.utcnow)


# { "client_slug:+18435551234": [Message, ...] }
_store: dict[str, list[Message]] = defaultdict(list)


def _key(client_slug: str, phone: str) -> str:
    return f"{client_slug}:{phone}"


def append(client_slug: str, phone: str, role: str, content: str) -> None:
    k = _key(client_slug, phone)
    _store[k].append(Message(role=role, content=content))
    if len(_store[k]) > MAX_HISTORY:
        _store[k] = _store[k][-MAX_HISTORY:]


def get_history(client_slug: str, phone: str) -> list[dict]:
    """Return history in the format Groq/OpenAI expects."""
    return [{"role": m.role, "content": m.content} for m in _store[_key(client_slug, phone)]]


def clear(client_slug: str, phone: str) -> None:
    _store.pop(_key(client_slug, phone), None)
