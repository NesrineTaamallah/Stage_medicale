import { IconHeart } from './Icons';

export default function BrandMark({ size = 34, iconSize }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size, borderRadius: size * 0.3 }}>
      <IconHeart size={iconSize || size * 0.5} color="#fff" />
    </span>
  );
}
