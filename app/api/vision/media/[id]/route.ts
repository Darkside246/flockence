import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { currentUserOrResponse } from "@/lib/current-user";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;

  try {
    const { id } = await context.params;
    const media = await prisma.visionMedia.findFirst({
      where: { id, farmId: session.user!.farmId },
      select: { id: true, storageKey: true, mimeType: true, byteSize: true },
    });
    if (!media) return NextResponse.json({ error: "Vision media not found." }, { status: 404 });

    if (!media.storageKey || path.basename(media.storageKey) !== media.storageKey || media.storageKey.includes("..")) {
      return NextResponse.json({ error: "Invalid media storage key." }, { status: 400 });
    }
    if (!ALLOWED_MIME_TYPES.has(media.mimeType.toLowerCase())) {
      return NextResponse.json({ error: "Unsupported stored media type." }, { status: 415 });
    }

    const root = path.resolve(process.env.VISION_STORAGE_DIR || path.join(process.cwd(), "storage", "vision"));
    const filePath = path.resolve(root, media.storageKey);
    if (!filePath.startsWith(root + path.sep)) {
      return NextResponse.json({ error: "Invalid media path." }, { status: 400 });
    }

    const body = await readFile(filePath);
    if (body.byteLength !== media.byteSize) {
      return NextResponse.json({ error: "Stored media integrity check failed." }, { status: 409 });
    }

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": media.mimeType,
        "Content-Length": String(body.byteLength),
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Vary": "Cookie",
      },
    });
  } catch {
    return NextResponse.json({ error: "Unable to load vision media." }, { status: 404 });
  }
}
