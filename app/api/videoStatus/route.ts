import { NextRequest, NextResponse } from "next/server";
import fetch from "node-fetch";

async function handle(req: NextRequest) {
  try {
    let data = await req.json();
    const videoId = data.video_id;
    const apiKey = process.env.X_Api_Key;
    const url = `https://api.heygen.com/v1/video_status.get?video_id=${videoId}`;
    while (true) {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "X-Api-Key": data.token === "" ? apiKey : data.token,
        },
      });
      const videoData: any = await response.json();
      const status = videoData.data.status;

      if (status === "processing" || status === "waiting") {
        await new Promise((resolve) => setTimeout(resolve, 2000)); // 延迟2秒钟
      } else if (status === "completed") {
        return NextResponse.json(videoData, { status: 200 });
      } else if (status === "failed") {
        return NextResponse.json(
          {
            code: 1,
            status: "FAIL",
            msg: "请求失败",
          },
          { status: 200 },
        );
      } else {
        return NextResponse.json(
          {
            code: 1,
            status: "FAIL",
            msg: "请求失败",
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
        msg: error.message || "未知错误，请查看服务端日志",
      },
      { status: 200 },
    );
  }
}

export const GET = handle;
export const POST = handle;
