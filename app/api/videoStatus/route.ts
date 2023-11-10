import { NextRequest, NextResponse } from "next/server";
import fetch from "node-fetch";

async function handle(req: NextRequest) {
  try {
    let data = await req.json();
    const videoId = data.video_id;
    const apiKey = process.env.HEYGEN_API_KEY;
    const url = `https://api.heygen.com/v1/video_status.get?video_id=${videoId}`;

    let status = "";
    while (status !== "failed" && status !== "completed") {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "X-Api-Key": data.token === "" ? apiKey : data.token,
        },
      });
      const videoData: any = await response.json();
      status = videoData.data.status;

      if (status === "processing" || status === "waiting") {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } else if (status === "completed") {
        return NextResponse.json(videoData, { status: 200 });
      } else if (status === "failed") {
        return NextResponse.json(videoData, { status: 200 });
      } else {
        return NextResponse.json(
          {
            code: 1,
            status: "FAIL",
            message: "未知错误，请稍后再次尝试",
          },
          { status: 200 },
        );
      }
    }
  } catch (error: any) {
    console.error(error);
    return NextResponse.json(
      {
        code: 1,
        status: "FAIL",
        message: error.message || "未知错误，请查看服务端日志",
      },
      { status: 200 },
    );
  }
}

export const GET = handle;
export const POST = handle;
