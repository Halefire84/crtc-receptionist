"""Voice endpoints — STT, TTS, and combined voice reply."""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query
from fastapi.responses import Response

from app.services import groq_service
from app.services.profile_service import load_profile
from app.models import conversation

router = APIRouter(prefix="/voice", tags=["voice"])


@router.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    """Audio file → transcript text. Whisper Large v3 Turbo."""
    audio_bytes = await audio.read()
    text = groq_service.transcribe_audio(audio_bytes, filename=audio.filename or "audio.m4a")
    return {"transcript": text}


@router.post("/speak")
async def speak(
    text: str = Form(...),
    voice: str = Form("troy"),
):
    """Text → WAV audio. Voices: troy (default), hannah, austin.
    Returns audio/wav bytes — pipe directly to a speaker or save to file.
    """
    audio_bytes = groq_service.speak(text, voice=voice)
    return Response(content=audio_bytes, media_type="audio/wav")


@router.post("/reply")
async def voice_reply(
    audio: UploadFile = File(...),
    client: str = Form(...),
    phone: str = Form(...),
    speak_reply: bool = Form(False),
    voice: str = Form("troy"),
):
    """Voice → AI response pipeline.
    1. Transcribes audio (Whisper)
    2. Runs through receptionist AI (LLaMA 3.3)
    3. Optionally speaks the reply (Orpheus TTS)

    Returns JSON with transcript + reply text, or WAV audio if speak_reply=true.
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

    if speak_reply:
        audio_reply = groq_service.speak(reply, voice=voice)
        return Response(content=audio_reply, media_type="audio/wav")

    return {"transcript": transcript, "reply": reply}
