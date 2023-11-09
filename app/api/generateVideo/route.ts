import { NextRequest, NextResponse } from "next/server";
import fetch from "node-fetch";
async function handle(req: NextRequest) {
  try {
    const API_KEY =
      "NjA0YzgzMDNkZDZlNGMwYjliNzdiNzg3NjRhMTc3OGItMTY5Nzc2NDg3Ng==";
    const API_URL = "https://api.heygen.com/v2/video/generate";
    console.log("--------");
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": API_KEY,
      },
      body: JSON.stringify({
        video_inputs: [
          {
            character: {
              type: "avatar",
              avatar_id: "Angela-inwhiteskirt-20220820",
              avatar_style: "normal",
              // type: "talking_photo",
              // talking_photo_id: "ba9c11684315405aac1dd8ed987fdda2"
            },
            voice: {
              type: "text",
              input_text: "1111",
              voice_id: "8a44173a27984487b3fa86e56004218c",
            },
            background: {
              type: "color",
              value: "#ffffff",
            },
          },
        ],
        test: false,
        aspect_ratio: "16:9",
      }),
    });
    const data = await response.json();
    console.log(data);
    return data
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
