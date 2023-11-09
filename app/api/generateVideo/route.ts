import { NextRequest, NextResponse } from "next/server";

async function handle(req: NextRequest) {
  try {
    const API_KEY = process.env.X_Api_Key; // 通过环境变量获取API密钥
    const API_URL = "https://api.heygen.com/v2/video/generate"; //

    try {
      const response = await fetch(API_URL, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": API_KEY || "NjA0YzgzMDNkZDZlNGMwYjliNzdiNzg3NjRhMTc3OGItMTY5Nzc2NDg3Ng==",
        },
      });

      const data = await response.json();
      console.log(data);
      
    } catch (error) {
      console.error(error);
    }
  } catch (e: any) {
    return NextResponse.json(
      {
        code: 1,
        status: "FAIL",
        msg: e.message || "未知错误，请查看服务端日志",
      },
      { status: 200 },
    );
  }
  return NextResponse.json(
    { code: 1, status: "FAIL", msg: "无效操作" },
    { status: 200 },
  );
}

export const GET = handle;
export const POST = handle;
