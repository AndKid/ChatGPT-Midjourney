import { NextRequest, NextResponse } from "next/server";
import fetch from "node-fetch";

async function handle(req: NextRequest) {
  try {
    let data = await req.json();
    let resRuest = JSON.stringify({
      data,
    });
    const API_KEY =
      "OWUxZDEwNzgxMTc4NDMxMThmZmRlMDQ1Y2FjNjkxNjMtMTY5OTI1MzA0OA==";
    const API_URL = "https://api.heygen.com/v2/video/generate";
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": API_KEY,
      },
      body: JSON.stringify({
        video_inputs: JSON.parse(resRuest).data.video_inputs,
        test: JSON.parse(resRuest).data.test,
        aspect_ratio: JSON.parse(resRuest).data.aspect_ratio,
      }),
    });
    const res = await response.json();
    console.log(res);
    return NextResponse.json(res, { status: 200 });
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
