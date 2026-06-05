import lcrLogo from "@/assets/lcr-logo.jpeg.asset.json";

export function LcrWordmark({ className = "" }: { className?: string }) {
  return (
    <div className={`font-display text-3xl tracking-tight ${className}`}>
      <span className="text-foreground">LCR</span>
      <span className="italic text-primary-hover ml-1.5">Contábil</span>
    </div>
  );
}

export function LcrLogo({ size = 36 }: { size?: number }) {
  return (
    <img
      src={lcrLogo.url}
      alt="LCR Contábil"
      width={size}
      height={size}
      style={{ width: size, height: size }}
    />
  );
}
