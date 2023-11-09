import { NextRequest, NextResponse } from "next/server";
import fetch from "node-fetch";
async function handle(req: NextRequest) {
  try {
    const API_KEY = "NjA0YzgzMDNkZDZlNGMwYjliNzdiNzg3NjRhMTc3OGItMTY5Nzc2NDg3Ng==";
    const API_URL = "https://api.heygen.com/v2/video/generate";
    console.log("--------");
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": API_KEY,
      },
    });
    const data = await response.json();
    console.log(data);
    return NextResponse.json(
      { code: 1, status: "SUCCESS", msg: "操作成功" },
      { status: 200 },
    );
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
