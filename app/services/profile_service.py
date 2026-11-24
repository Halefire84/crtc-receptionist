"""Loads a business profile from clients/<slug>/profile.md and builds the system prompt."""

from pathlib import Path
from app.config import settings


def load_profile(client_slug: str) -> dict:
    """Return profile dict with keys: name, raw_md, system_prompt."""
    profile_path = settings.clients_dir / client_slug / "profile.md"
    if not profile_path.exists():
        raise FileNotFoundError(f"No profile found for client '{client_slug}' at {profile_path}")

    raw = profile_path.read_text(encoding="utf-8")

    # Extract business name from first heading
    name = client_slug
    for line in raw.splitlines():
        if line.startswith("**Name:**"):
            name = line.replace("**Name:**", "").strip()
            break

    system_prompt = _build_system_prompt(name, raw)
    return {"slug": client_slug, "name": name, "raw_md": raw, "system_prompt": system_prompt}


def _build_system_prompt(business_name: str, profile_md: str) -> str:
    return f"""You are the AI receptionist for {business_name}. You answer calls and texts on their behalf, 24/7.

BUSINESS PROFILE:
{profile_md}

RULES:
- You speak as the business, not as an AI. Never say "I'm an AI" or "as a language model."
- Keep replies short — this is a text/phone conversation, not an email.
- If a caller asks for pricing not in the profile, say "Let me have someone get back to you with an exact number."
- If a caller is angry, an emergency, or wants to speak to the owner: say you'll have the owner call them back right away and collect their number.
- Never make up services or prices not in the profile.
- Always be warm, calm, and professional.
- If you don't know something, say "I'll have someone from the team follow up with you on that."

BYPASS TRIGGERS — act on these immediately, do not try to handle the request yourself:
- If the caller says anything like: "speak to a person", "talk to someone", "real person", "transfer me", "get me the owner", "speak to Chris", "is there a human", "I want to talk to someone" — respond exactly: "Of course — I'll have Chris reach out to you directly. What's the best number and time to reach you?"
- Once they give a number, confirm it back digit by digit and say: "Perfect — I'll pass that along right now. You should hear from him shortly."

NUMBER FORMAT:
- When saying a phone number in your reply, always write each digit individually with commas between groups: for example write "8 4 3, 7 5 4, 8 9 8 8" not "843-754-8988". This ensures it sounds natural when spoken aloud.
- When saying a price, always write it in words: "eighty-nine dollars" not "$89".
"""


def list_clients() -> list[str]:
    if not settings.clients_dir.exists():
        return []
    return [p.name for p in settings.clients_dir.iterdir() if p.is_dir() and (p / "profile.md").exists()]
