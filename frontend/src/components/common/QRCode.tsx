import React from "react";
import { QRCodeCanvas } from "qrcode.react";

export default function QRCode({ value, size = 140 }: { value: string; size?: number }) {
  return <QRCodeCanvas value={value} size={size} includeMargin />;
}
