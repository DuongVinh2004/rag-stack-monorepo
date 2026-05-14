import React from 'react';

export function Skeleton({ className = '', style = {} }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton-pulse ${className}`} style={style} />;
}
