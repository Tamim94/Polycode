FROM python:3.12-slim
WORKDIR /app

# ffmpeg is required by Whisper to decode audio from the video file
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONPATH=/app

COPY requirements.txt .

# CPU-only torch — the default PyPI wheel pulls in CUDA libraries that are
# unused here and roughly triple the image size.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements.txt

# Bake every model into the image at build time so the container needs
# zero network access at runtime. Kept above all app-source COPY steps
# (below) so editing pipeline/api code or swapping the demo video never
# invalidates these (slow) layers.
RUN python -c "import whisper; whisper.load_model('small')"
COPY install_argos.py .
RUN python install_argos.py
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"
RUN python -c "import nltk; nltk.download('punkt')"
RUN python -c "import nltk; nltk.download('punkt_tab')" || true

COPY pipeline ./pipeline
COPY utils ./utils
COPY api ./api
COPY main.py .
COPY videos ./videos

RUN mkdir -p /app/outputs

EXPOSE 8001
CMD ["python", "-m", "uvicorn", "api.app:app", "--host", "0.0.0.0", "--port", "8001"]
