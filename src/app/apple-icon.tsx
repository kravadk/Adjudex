import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0A0A0A",
        }}
      >
        <div
          style={{
            width: 132,
            height: 132,
            borderRadius: 32,
            background: "#FFB800",
            color: "#0A0A0A",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 64,
            fontWeight: 800,
            fontFamily: "Arial, Helvetica, sans-serif",
            letterSpacing: 0,
            boxShadow: "0 0 0 7px #39FF14",
          }}
        >
          P
        </div>
      </div>
    ),
    size,
  );
}
