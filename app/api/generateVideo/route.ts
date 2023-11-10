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
          JSON.parse(resRuest).data.token === ""
            ? API_KEY
            : JSON.parse(resRuest).data.token,
      },
      body: JSON.stringify({
        video_inputs: JSON.parse(resRuest).data.video_inputs,
        test: JSON.parse(resRuest).data.test,
        aspect_ratio: JSON.parse(resRuest).data.aspect_ratio,
      }),
    });
    const res = await response.json();

      return NextResponse.json(res, { status: 200 });
    // } else {
    //   return NextResponse.json(
    //     {
    //       data: null,
    //       error: {
    //         message: "请检查当前会话是否有权限，如有问题请联系管理员",
    //       },
    //     },
    //     { status: 200 },
    //   );
    // }
  } catch (error: any) {
    console.error(error);
    return NextResponse.json(
      {
        data: null,
        error: {
          message: "服务暂不可用",
        },
      },
      { status: 200 },
    );
  }
}

export const GET = handle;
export const POST = handle;
