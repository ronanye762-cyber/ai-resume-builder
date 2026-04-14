import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // canvas 是 pdfjs-dist 的可选 native 依赖，排除掉防止打包报错
  serverExternalPackages: ['canvas'],
};

export default nextConfig;
