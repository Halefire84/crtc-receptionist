"""Voice endpoint — transcribes audio via Groq Whisper, optionally replies."""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException

from app.services import groq_service
from app.services.profile_service import load_profile
from app.models import conversation

router = APIRouter(prefix="/voice", tags=["voice"])


@router.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    """Transcribe an audio file. Returns the text."""
    audio_bytes = await audio.read()
    text = groq_service.transcribe_audio(audio_bytes, filename=audio.filename or "audio.m4a")
    return {"transcript": text}


@router.post("/reply")
async def voice_reply(
    audio: UploadFile = File(...),
    client: str = Form(...),
    phone: str = Form(...),
):
    """
    Transcribe voice, run through receptionist AI, return both transcript and reply.
    Use this when you want voice → AI response in one call.
    """
    try:
        profile = load_profile(client)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Client '{client}' not found")

    audio_bytes = await audio.read()
    transcript = groq_service.transcribe_audio(audio_bytes, filename=audio.filename or "audio.m4a")

    conversation.append(client, phone, "user", transcript)
    history = conversation.get_history(client, phone)

    reply = groq_service.chat(
        system_prompt=profile["system_prompt"],
        history=history[:-1],
        user_message=transcript,
    )

    conversation.append(client, phone, "assistant", reply)

    return {"transcript": transcript, "reply": reply}
