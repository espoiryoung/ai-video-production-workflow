import dotenv from "dotenv";
import { config, higgsfield } from "@higgsfield/client/v2";

// This is a server-side script. Never import it into browser/client code.
dotenv.config({ path: ".env.local" });

const credentials = process.env.HF_CREDENTIALS;

if (!credentials) {
  throw new Error(
    "HF_CREDENTIALS is missing. Enter it in .env.local as key-id:key-secret before running this script.",
  );
}

config({ credentials });

try {
  const result = await higgsfield.subscribe(
    "bytedance/seedance-2.5/text-to-video",
    {
      input: {
        prompt: "A cinematic scene at sunset",
        duration: 5,
        resolution: "720p",
        aspect_ratio: "16:9",
      },
      withPolling: true,
    },
  );

  if (result.status === "completed") {
    const videoUrl = result.video?.url;

    if (!videoUrl) {
      throw new Error("The request completed but did not include a video URL.");
    }

    console.log(videoUrl);
  } else if (result.status === "failed" || result.status === "nsfw") {
    console.error(`Video generation ${result.status}.`);
    process.exitCode = 1;
  } else {
    console.error(`Video generation ended with unexpected status: ${result.status}`);
    process.exitCode = 1;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Video generation request failed: ${message}`);
  process.exitCode = 1;
}
