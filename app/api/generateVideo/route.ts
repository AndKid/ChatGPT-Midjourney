import { NextRequest, NextResponse } from "next/server";
import fetch from "node-fetch";

async function handle(req: NextRequest) {
  try {
    let data = await req.json();
    let resRuest = JSON.stringify({
      data,
    });
    const API_KEY = process.env.X_Api_Key;
    const API_URL = "https://api.heygen.com/v2/video/generate";
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key":
          API_KEY ||
          "OWUxZDEwNzgxMTc4NDMxMThmZmRlMDQ1Y2FjNjkxNjMtMTY5OTI1MzA0OA==",
      },
      body: JSON.stringify({
        video_inputs: JSON.parse(resRuest).data.video_inputs,
        test: JSON.parse(resRuest).data.test,
        aspect_ratio: JSON.parse(resRuest).data.aspect_ratio,
      }),
    });
    const res: any = await response.json();
    if (res.code === 400664) {
      return NextResponse.json(res, { status: 200 });
    } else if (res.error === null) {
      const checkVideoStatus = async () => {
        const url = `https://api.heygen.com/v1/video_status.get?video_id=${res.data.video_id}`;
        const response = await fetch(url, {
          method: "GET",
          headers: {
            "X-Api-Key":
              process.env.X_Api_Key ||
              "OWUxZDEwNzgxMTc4NDMxMThmZmRlMDQ1Y2FjNjkxNjMtMTY5OTI1MzA0OA==",
          },
        });
        const videoData: any = await response.json();

        if (videoData.code === 100) {
          const status = videoData.data.status;
          if (status === "processing" || status === "waiting") {
            setTimeout(checkVideoStatus, 2000);
          } else if (status === "completed") {
            return NextResponse.json(videoData, { status: 200 });
          } else if (status === "failed") {
            return NextResponse.json(videoData, { status: 200 });
          } else {
            return NextResponse.json(videoData, { status: 200 });
          }
        } else {
          return NextResponse.json(videoData, { status: 200 });
        }
      };

      checkVideoStatus();
    } else {
      return NextResponse.json(res, { status: 200 });
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
