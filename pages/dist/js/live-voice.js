const LIVE_MODEL = "gemini-3.8-live";
const LIVE_SOCKET_ENDPOINT = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
const OUTPUT_RATE = 24000;
const INPUT_RATE = 16000;

function liveConfig(systemInstruction) {
  return {
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
      },
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    systemInstruction: { parts: [{ text: systemInstruction }] },
  };
}

async function requestLiveToken(apiBase, authToken) {
  const response = await fetch(`${apiBase.replace(/\/+$/, "")}/live/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: "{}",
  });
  if (!response.ok) {
    let message = `Worker gagal menyiapkan Gemini Live (HTTP ${response.status}).`;
    try {
      const body = await response.json();
      if (body.error?.message) message = body.error.message;
    } catch {
      // Keep the explicit HTTP status when the provider response is not JSON.
    }
    throw new Error(message);
  }
  const result = await response.json();
  if (typeof result.token !== "string" || !result.token) {
    throw new Error("Gemini Live tidak mengembalikan token sesi.");
  }
  return result.token;
}

function toBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function resampleTo16k(input, inputRate) {
  if (inputRate === INPUT_RATE) return input;
  const outputLength = Math.floor(input.length * INPUT_RATE / inputRate);
  const output = new Float32Array(outputLength);
  const ratio = inputRate / INPUT_RATE;
  for (let index = 0; index < outputLength; index++) {
    const position = index * ratio;
    const left = Math.floor(position);
    const fraction = position - left;
    const right = Math.min(left + 1, input.length - 1);
    output[index] = input[left] * (1 - fraction) + input[right] * fraction;
  }
  return output;
}

function pcm16Bytes(samples) {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return new Uint8Array(pcm.buffer);
}

function decodePcm16(base64) {
  const binary = atob(base64);
  const length = binary.length - (binary.length % 2);
  const samples = new Float32Array(length / 2);
  for (let index = 0; index < samples.length; index++) {
    let sample = binary.charCodeAt(index * 2) | (binary.charCodeAt(index * 2 + 1) << 8);
    if (sample & 0x8000) sample -= 0x10000;
    samples[index] = sample / 0x8000;
  }
  return samples;
}

function extractTranscription(event, key) {
  const text = event?.serverContent?.[key]?.text;
  return typeof text === "string" ? text : "";
}

async function websocketFrameText(data) {
  if (typeof data === "string") return data;
  if (data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  throw new Error(`Jenis frame Gemini Live tidak didukung: ${Object.prototype.toString.call(data)}.`);
}

export async function startGeminiLiveSession({ apiBase, authToken, systemInstruction, videoElement = null, onEvent = () => {} }) {
  if (!apiBase || !authToken) throw new Error("Masuk dengan akun yang diizinkan untuk memakai Gemini Live.");
  if (!window.isSecureContext) throw new Error("Percakapan realtime memerlukan HTTPS atau localhost.");
  if (!navigator.mediaDevices?.getUserMedia || !window.WebSocket) {
    throw new Error("Browser ini tidak mendukung mikrofon atau koneksi realtime. Coba Chrome atau Edge terbaru.");
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("Browser ini tidak mendukung pemrosesan audio realtime.");

  let mediaStream;
  let audioContext;
  let socket;
  let source;
  let processor;
  let muteGain;
  let videoFrameTimer = 0;
  let closed = false;
  let socketReady = false;
  let nextAudioStart = 0;
  const playbackNodes = new Set();
  const config = liveConfig(systemInstruction);

  const close = async () => {
    if (closed) return;
    closed = true;
    window.clearInterval(videoFrameTimer);
    if (processor) {
      processor.onaudioprocess = null;
      processor.disconnect();
    }
    source?.disconnect();
    muteGain?.disconnect();
    for (const node of playbackNodes) {
      try {
        node.stop();
      } catch (error) {
        if (error.name !== "InvalidStateError") console.warn("Live audio cleanup failed:", error);
      }
    }
    playbackNodes.clear();
    mediaStream?.getTracks().forEach((track) => track.stop());
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "Voice session ended");
    if (audioContext && audioContext.state !== "closed") await audioContext.close();
    onEvent({ type: "closed" });
  };

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    audioContext = new AudioContextClass({ sampleRate: INPUT_RATE });
    await audioContext.resume();

    onEvent({ type: "status", message: "Menghubungkan ke Gemini Live…" });
    const token = await requestLiveToken(apiBase, authToken);
    socket = new WebSocket(`${LIVE_SOCKET_ENDPOINT}?access_token=${encodeURIComponent(token)}`);

    await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Gemini Live tidak merespons saat menyiapkan sesi.")), 20000);
      const fail = (error) => {
        window.clearTimeout(timeout);
        reject(error);
      };
      let incomingMessages = Promise.resolve();
      socket.onopen = () => {
        socket.send(JSON.stringify({
          setup: {
            model: `models/${LIVE_MODEL}`,
            ...config,
          },
        }));
      };
      socket.onerror = () => {
        if (!socketReady) fail(new Error("Koneksi Gemini Live gagal. Periksa jaringan, API key, dan akses model."));
        else onEvent({ type: "error", message: "Koneksi Gemini Live terputus." });
      };
      socket.onclose = (event) => {
        if (!socketReady) fail(new Error(event.reason || "Gemini Live menutup koneksi sebelum sesi siap."));
        else if (!closed) onEvent({ type: "error", message: "Koneksi Gemini Live terputus. Akhiri sesi lalu coba lagi." });
      };
      const handleMessage = async (messageEvent) => {
        let rawMessage;
        let message;
        try {
          rawMessage = await websocketFrameText(messageEvent.data);
          message = JSON.parse(rawMessage);
        } catch (cause) {
          const error = new Error(
            cause instanceof SyntaxError
              ? `Gemini Live mengirim frame ${messageEvent.data?.constructor?.name || typeof messageEvent.data} yang bukan JSON.`
              : cause.message,
          );
          if (!socketReady) fail(error);
          else onEvent({ type: "error", message: error.message });
          return;
        }
        if (message.error) {
          const error = new Error(message.error.message || "Gemini Live menolak koneksi.");
          if (!socketReady) fail(error);
          else onEvent({ type: "error", message: error.message });
          return;
        }
        if (message.setupComplete) {
          socketReady = true;
          window.clearTimeout(timeout);
          source = audioContext.createMediaStreamSource(mediaStream);
          processor = audioContext.createScriptProcessor(4096, 1, 1);
          muteGain = audioContext.createGain();
          muteGain.gain.value = 0;
          processor.onaudioprocess = (audioEvent) => {
            if (closed || socket.readyState !== WebSocket.OPEN) return;
            const input = audioEvent.inputBuffer.getChannelData(0);
            const pcm = pcm16Bytes(resampleTo16k(input, audioContext.sampleRate));
            if (!pcm.length) return;
            socket.send(JSON.stringify({
              realtimeInput: {
                audio: { data: toBase64(pcm), mimeType: `audio/pcm;rate=${INPUT_RATE}` },
              },
            }));
          };
          if (videoElement) {
            videoFrameTimer = window.setInterval(() => {
              if (
                closed
                || socket.readyState !== WebSocket.OPEN
                || videoElement.classList.contains("hidden")
                || videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
                || !videoElement.videoWidth
                || !videoElement.videoHeight
              ) return;
              try {
                const scale = Math.min(1, 640 / videoElement.videoWidth);
                const canvas = document.createElement("canvas");
                canvas.width = Math.round(videoElement.videoWidth * scale);
                canvas.height = Math.round(videoElement.videoHeight * scale);
                const context = canvas.getContext("2d");
                if (!context) throw new Error("Canvas kamera tidak tersedia.");
                context.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
                const data = canvas.toDataURL("image/jpeg", 0.7).split(",", 2)[1];
                if (!data) throw new Error("Cuplikan kamera gagal dikodekan.");
                socket.send(JSON.stringify({
                  realtimeInput: {
                    video: { data, mimeType: "image/jpeg" },
                  },
                }));
              } catch (error) {
                window.clearInterval(videoFrameTimer);
                onEvent({ type: "error", message: `Video Gemini Live gagal dikirim: ${error.message || error}` });
              }
            }, 1000);
          }
          source.connect(processor);
          processor.connect(muteGain);
          muteGain.connect(audioContext.destination);
          onEvent({ type: "ready" });
          resolve();
          return;
        }

        const serverContent = message.serverContent;
        const userText = extractTranscription(message, "inputTranscription");
        const assistantText = extractTranscription(message, "outputTranscription");
        if (userText) onEvent({ type: "user-transcript", text: userText });
        if (assistantText) onEvent({ type: "assistant-transcript", text: assistantText });

        if (serverContent?.interrupted) {
          for (const node of playbackNodes) {
            try {
              node.stop();
            } catch (error) {
              if (error.name !== "InvalidStateError") console.warn("Live audio interruption failed:", error);
            }
          }
          playbackNodes.clear();
          nextAudioStart = audioContext.currentTime;
          onEvent({ type: "interrupted" });
          onEvent({ type: "listening" });
        }

        for (const part of serverContent?.modelTurn?.parts || []) {
          const inlineData = part.inlineData || part.inline_data;
          if (!inlineData?.data || !String(inlineData.mimeType || inlineData.mime_type || "").startsWith("audio/pcm")) continue;
          const samples = decodePcm16(inlineData.data);
          if (!samples.length) continue;
          const buffer = audioContext.createBuffer(1, samples.length, OUTPUT_RATE);
          buffer.copyToChannel(samples, 0);
          const node = audioContext.createBufferSource();
          node.buffer = buffer;
          node.connect(audioContext.destination);
          playbackNodes.add(node);
          node.onended = () => {
            playbackNodes.delete(node);
            if (!playbackNodes.size && !closed) onEvent({ type: "listening" });
          };
          nextAudioStart = Math.max(nextAudioStart, audioContext.currentTime + 0.02);
          node.start(nextAudioStart);
          nextAudioStart += buffer.duration;
          onEvent({ type: "speaking" });
        }
        if (serverContent?.turnComplete) onEvent({ type: "turn-complete" });
      };
      socket.onmessage = (messageEvent) => {
        incomingMessages = incomingMessages
          .then(() => handleMessage(messageEvent))
          .catch((error) => {
            if (!socketReady) fail(error);
            else onEvent({ type: "error", message: error.message || "Respons Gemini Live gagal diproses." });
          });
      };
    });

    return {
      close,
      setMuted(muted) {
        if (mediaStream) {
          for (const track of mediaStream.getAudioTracks()) track.enabled = !muted;
        }
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
