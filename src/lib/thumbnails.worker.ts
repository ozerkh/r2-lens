const SIZE = 320;
const CONCURRENCY = 4;

type Request = { type: "load"; id: number; url: string } | { type: "cancel"; id: number };
export type ThumbnailResponse = { id: number; blob?: Blob; error?: string };

const queue: { id: number; url: string }[] = [];
const running = new Map<number, AbortController>();

self.onmessage = (event: MessageEvent<Request>) => {
  const message = event.data;
  if (message.type === "load") {
    queue.push(message);
    pump();
    return;
  }
  const index = queue.findIndex((job) => job.id === message.id);
  if (index >= 0) queue.splice(index, 1);
  running.get(message.id)?.abort();
};

function pump() {
  while (running.size < CONCURRENCY && queue.length) {
    const job = queue.shift()!;
    const controller = new AbortController();
    running.set(job.id, controller);
    render(job.url, controller.signal)
      .then((blob) => respond({ id: job.id, blob }))
      .catch((error: Error) => {
        if (error.name !== "AbortError") respond({ id: job.id, error: error.message });
      })
      .finally(() => {
        running.delete(job.id);
        pump();
      });
  }
}

async function render(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal, credentials: "same-origin" });
  if (!response.ok) throw new Error(`Failed to load (${response.status})`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    signal.throwIfAborted();
    const scale = Math.min(1, SIZE / Math.min(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas unavailable");
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    return await canvas.convertToBlob({ type: "image/webp", quality: 0.8 });
  } finally {
    bitmap.close();
  }
}

function respond(message: ThumbnailResponse) {
  self.postMessage(message);
}
