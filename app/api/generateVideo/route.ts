import { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const API_KEY = process.env.X_Api_Key; // 通过环境变量获取API密钥
  const API_URL = "https://api.heygen.com/v2/video/generate"; // 

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key":"NjA0YzgzMDNkZDZlNGMwYjliNzdiNzg3NjRhMTc3OGItMTY5Nzc2NDg3Ng==",
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "An error occurred" });
  }
}
