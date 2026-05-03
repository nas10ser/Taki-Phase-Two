import React from 'react';

/**
 * Simple SVG Barcode renderer (Code128-style visual).
 * Shared component used in Bookings page and DealDetails page.
 */
interface BarcodeVisualProps {
    code: string;
    width?: number;
    height?: number;
}

const BarcodeVisual: React.FC<BarcodeVisualProps> = ({ code, width = 220, height = 70 }) => {
    const bars: number[] = [];
    for (let i = 0; i < code.length; i++) {
        const charCode = code.charCodeAt(i);
        // Generate pattern from character code
        bars.push(charCode % 4 + 1);
        bars.push(2);
        bars.push(charCode % 3 + 1);
        bars.push(1);
        bars.push(charCode % 5 + 1);
        bars.push(2);
    }
    const totalWidth = bars.reduce((sum, w) => sum + w, 0);

    return (
        <svg width={width} height={height} viewBox={`0 0 ${totalWidth} 50`} style={{ display: 'block' }}>
            {bars.map((barWidth, i) => {
                const x = bars.slice(0, i).reduce((sum, w) => sum + w, 0);
                return i % 2 === 0 ? (
                    <rect key={i} x={x} y="0" width={barWidth} height="50" fill="currentColor" />
                ) : null;
            })}
        </svg>
    );
};

export default React.memo(BarcodeVisual);
