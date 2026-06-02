import { ImageResponse } from "next/og";

export const size = {
  width: 512,
  height: 512,
};

export const contentType = "image/png";

export default function Icon() {
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
            width: 368,
            height: 368,
            borderRadius: 88,
            background: "#FFB800",
            color: "#0A0A0A",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 168,
            fontWeight: 800,
            fontFamily: "Arial, Helvetica, sans-serif",
            letterSpacing: 0,
            boxShadow: "0 0 0 18px #39FF14",
          }}
        >
          P
        </div>
      </div>
    ),
    size,
  );
}
