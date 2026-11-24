"""Groq backend — all four capabilities:
  chat     : LLaMA 3.3 70B (receptionist replies)
  transcribe: Whisper Large v3 Turbo (voice → text)
  speak    : Orpheus v1 English (text → audio)
  vision   : Muse Spark Open (image understanding — MMS photos from customers)
"""

import io
import re
import base64
from pathlib import Path
from groq import Groq
from app.config import settings


def _tts_preprocess(text: str) -> str:
    """Format text for natural TTS output before sending to Orpheus.

    Orpheus reads '$89' as 'dollar eighty-nine' and phone numbers like
    '843-754-8988' as 'eight hundred forty-three...' — both sound wrong.
    This converts to spoken-word equivalents before synthesis.
    """
    # Phone numbers: (843) 754-8988 or 843-754-8988 or 8435558988
    def _phone(m: re.Match) -> str:
        digits = re.sub(r"\D", "", m.group())
        if len(digits) == 10:
            return f"{' '.join(digits[:3])}, {' '.join(digits[3:6])}, {' '.join(digits[6:])}"
        if len(digits) == 11 and digits[0] == "1":
            d = digits[1:]
            return f"{' '.join(d[:3])}, {' '.join(d[3:6])}, {' '.join(d[6:])}"
        return m.group()

    text = re.sub(r"\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}", _phone, text)
    text = re.sub(r"\b1?\d{10}\b", _phone, text)

    # Prices: $89 → 89 dollars, $1,200 → 1200 dollars
    def _price(m: re.Match) -> str:
        amount = m.group(1).replace(",", "")
        cents = m.group(2)
        if cents:
            return f"{amount} dollars and {cents} cents"
        return f"{amount} dollars"

    text = re.sub(r"\$(\d[\d,]*)(?:\.(\d{2}))?", _price, text)

    return text

_client: Groq | None = None


def _get_client() -> Groq:
    global _client
    if _client is None:
        if not settings.groq_api_key:
            raise RuntimeError("GROQ_API_KEY is not set. Add it to .env")
        _client = Groq(api_key=settings.groq_api_key)
    return _client


# ── Chat ──────────────────────────────────────────────────────────────────────

def chat(system_prompt: str, history: list[dict], user_message: str) -> str:
    """LLaMA 3.3 70B — receptionist reply. Returns text."""
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(history)
    messages.append({"role": "user", "content": user_message})

    response = _get_client().chat.completions.create(
        model=settings.groq_chat_model,
        messages=messages,
        max_tokens=300,
        temperature=0.4,
    )
    return response.choices[0].message.content.strip()


# ── Speech-to-Text ────────────────────────────────────────────────────────────

def transcribe_audio(audio_bytes: bytes, filename: str = "audio.m4a") -> str:
    """Whisper Large v3 Turbo — audio bytes → transcript text."""
    audio_file = io.BytesIO(audio_bytes)
    audio_file.name = filename

    response = _get_client().audio.transcriptions.create(
        model=settings.groq_voice_model,
        file=audio_file,
        response_format="text",
        language="en",
        temperature=0.0,
    )
    return response.strip() if isinstance(response, str) else response.text.strip()


# ── Text-to-Speech ────────────────────────────────────────────────────────────

def speak(text: str, voice: str | None = None) -> bytes:
    """Orpheus — text → WAV audio bytes.
    voice options: troy (male, default), hannah (female), austin (male casual)
    """
    response = _get_client().audio.speech.create(
        model=settings.groq_tts_model,
        voice=voice or settings.groq_tts_voice,
        input=_tts_preprocess(text),
        response_format="wav",
    )
    # response is an APIResponse with .content (bytes) or .read()
    if hasattr(response, "content"):
        return response.content
    if hasattr(response, "read"):
        return response.read()
    # Fallback: write to temp buffer
    buf = io.BytesIO()
    response.write_to_file(buf)
    return buf.getvalue()


# ── Vision ────────────────────────────────────────────────────────────────────

def describe_image(
    image_source: str | bytes,
    prompt: str = "Describe what you see in this image.",
    system_prompt: str = "",
) -> str:
    """Muse Spark Open — image → text description.

    image_source: URL string  OR  raw image bytes (JPEG/PNG/WebP)
    Returns the model's description.
    """
    if isinstance(image_source, bytes):
        b64 = base64.b64encode(image_source).decode("utf-8")
        image_content = {
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
        }
    else:
        image_content = {
            "type": "image_url",
            "image_url": {"url": image_source},
        }

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({
        "role": "user",
        "content": [image_content, {"type": "text", "text": prompt}],
    })

    response = _get_client().chat.completions.create(
        model=settings.groq_vision_model,
        messages=messages,
        max_tokens=400,
    )
    return response.choices[0].message.content.strip()


def describe_image_with_profile(
    image_bytes: bytes,
    system_prompt: str,
    customer_message: str = "",
) -> str:
    """Vision + business profile — customer sends an MMS photo, receptionist responds."""
    prompt = customer_message if customer_message else (
        "A customer sent this photo. Describe what you see and how it relates to our services."
    )
    return describe_image(
        image_source=image_bytes,
        prompt=prompt,
        system_prompt=system_prompt,
    )
