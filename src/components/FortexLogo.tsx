interface FortexLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
}

export default function FortexLogo({ size = 'md', showText = true, className = '' }: FortexLogoProps) {
  const dims = { sm: { box: 24, text: 'text-sm' }, md: { box: 32, text: 'text-lg' }, lg: { box: 44, text: 'text-2xl' } };
  const { box, text } = dims[size];
  const r = Math.round(box * 0.22);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <svg width={box} height={box} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="64" height="64" rx={r} fill="#0d1117"/>
        <defs>
          <linearGradient id="flg" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#00d4aa"/>
            <stop offset="100%" stopColor="#0096c7"/>
          </linearGradient>
        </defs>
        <rect x="12" y="12" width="34" height="9" rx="2" fill="url(#flg)"/>
        <rect x="12" y="27" width="24" height="8" rx="2" fill="url(#flg)"/>
        <rect x="12" y="12" width="9" height="40" rx="2" fill="url(#flg)"/>
        <path d="M40 31 L52 38 L40 45 Z" fill="#00d4aa" opacity="0.7"/>
      </svg>
      {showText && (
        <span className={`font-bold tracking-wide ${text}`}
          style={{ fontFamily: "'Oswald', sans-serif", letterSpacing: '0.08em' }}>
          FORTEX
        </span>
      )}
    </div>
  );
}
