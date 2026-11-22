"""Groq backend: LLaMA 3.3 70B for chat, Whisper Large v3 for voice transcription."""

from groq import Groq
from app.config import settings

_client: Groq | None = None


def _get_client() -> Groq:
    global _client
    if _client is None:
        if not settings.groq_api_key:
            raise RuntimeError("GROQ_API_KEY is not set. Add it to .env")
        _client = Groq(api_key=settings.groq_api_key)
    return _client


def chat(system_prompt: str, history: list[dict], user_message: str) -> str:
    """Send a message with full conversation history. Returns the AI reply text."""
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


def transcribe_audio(audio_bytes: bytes, filename: str = "audio.m4a") -> str:
    """Transcribe audio bytes using Groq Whisper. Returns transcript text."""
    import io
    audio_file = io.BytesIO(audio_bytes)
    audio_file.name = filename

    response = _get_client().audio.transcriptions.create(
        model=settings.groq_voice_model,
        file=audio_file,
        response_format="text",
    )
    return response.strip() if isinstance(response, str) else response.text.strip()
