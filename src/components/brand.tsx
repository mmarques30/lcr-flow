import lcrLogo from "@/assets/lcr-logo.jpeg.asset.json";

export function IAplicadaWordmark({ className = "" }: { className?: string }) {
  return (
    <div className={`font-display text-3xl tracking-tight ${className}`}>
      <span className="text-foreground">IA</span>
      <span className="italic text-primary-hover">plicada</span>
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
      className="rounded-md bg-white p-0.5"
      style={{ width: size, height: size }}
    />
  );
}
