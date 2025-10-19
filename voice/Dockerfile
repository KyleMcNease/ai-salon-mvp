FROM python:3.11-slim
RUN apt-get update && apt-get install -y \
    espeak-ng \
    git \
    curl \
    build-essential \
    cmake \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Clone neutts-air and install its dependencies
RUN git clone https://github.com/neuphonic/neutts-air.git /app/neutts-air && \
    cd /app/neutts-air && \
    pip install --no-cache-dir -r requirements.txt

# Install API server dependencies
RUN pip install --no-cache-dir fastapi uvicorn[standard] llama-cpp-python onnxruntime

# Add neutts-air to Python path
ENV PYTHONPATH="/app/neutts-air:${PYTHONPATH}"

COPY app.py ./app.py
EXPOSE 9009 9010
CMD ["uvicorn", "app:app", "--host", "::", "--port", "9009"]
