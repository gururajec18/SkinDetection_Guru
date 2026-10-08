document.addEventListener('DOMContentLoaded', () => {
    const mobileInput = document.getElementById('image-input');
    const resultsContainer = document.getElementById('results-container');
    const originalPreviewContainer = document.getElementById('original-preview-container');
    const originalPreview = document.getElementById('original-preview');
    const recommendationText = document.getElementById('recommendation-text');
    const recommendationReason = document.getElementById('recommendation-reason');

    let comparisonChart = null;

    mobileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            originalPreview.src = event.target.result;
            originalPreviewContainer.classList.remove('hidden');
            resultsContainer.classList.remove('hidden');
            processImage(event.target.result);
        };
        reader.readAsDataURL(file);
    });

    async function processImage(imageSrc) {
        const img = new Image();
        img.src = imageSrc;
        await new Promise(resolve => img.onload = resolve);

        // Resize if too large for performance
        const MAX_WIDTH = 600;
        let width = img.width;
        let height = img.height;

        if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
        }

        const stats = {
            log: 0,
            yiq: 0,
            hsv: 0,
            ycbcr: 0
        };

        const canvasIds = ['canvas-log', 'canvas-yiq', 'canvas-hsv', 'canvas-ycbcr'];
        const canvases = canvasIds.map(id => document.getElementById(id));
        const ctxs = canvases.map(c => {
            c.width = width;
            c.height = height;
            return c.getContext('2d', { willReadFrequently: true });
        });

        const offCanvas = document.createElement('canvas');
        offCanvas.width = width;
        offCanvas.height = height;
        const offCtx = offCanvas.getContext('2d');
        offCtx.drawImage(img, 0, 0, width, height);
        const imageData = offCtx.getImageData(0, 0, width, height);
        const data = imageData.data;

        const resultsData = canvasIds.map(() => new Uint8ClampedArray(data.length));

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];

            // 1. Log Opponent
            if (isSkinLog(r, g, b)) {
                setPixel(resultsData[0], i, r, g, b);
                stats.log++;
            } else {
                setPixel(resultsData[0], i, 0, 0, 0);
            }

            // 2. YIQ
            if (isSkinYIQ(r, g, b)) {
                setPixel(resultsData[1], i, r, g, b);
                stats.yiq++;
            } else {
                setPixel(resultsData[1], i, 0, 0, 0);
            }

            // 3. HSV
            if (isSkinHSV(r, g, b)) {
                setPixel(resultsData[2], i, r, g, b);
                stats.hsv++;
            } else {
                setPixel(resultsData[2], i, 0, 0, 0);
            }

            // 4. YCbCr
            if (isSkinYCbCr(r, g, b)) {
                setPixel(resultsData[3], i, r, g, b);
                stats.ycbcr++;
            } else {
                setPixel(resultsData[3], i, 0, 0, 0);
            }
        }

        // Put image data back to canvases
        resultsData.forEach((buf, idx) => {
            const imgData = new ImageData(buf, width, height);
            ctxs[idx].putImageData(imgData, 0, 0);
        });

        updateStats(stats);
        updateChart(stats);
        recommendAlgorithm(stats);
    }

    function setPixel(buf, i, r, g, b) {
        buf[i] = r;
        buf[i + 1] = g;
        buf[i + 2] = b;
        buf[i + 3] = 255;
    }

    // ALGORITHMS

    function isSkinLog(r, g, b) {
        // Log Opponent: I = L(G), Rg = L(R)-L(G), By = L(B)-(L(G)+L(R))/2
        const L = (x) => Math.log10(x + 1);
        const lr = L(r);
        const lg = L(g);
        const lb = L(b);

        const rg = lr - lg;
        const by = lb - (lg + lr) / 2;

        // Characteristic values for skin in log-opponent space
        return (rg > 0.05 && rg < 0.6) && (by > -0.6 && by < 0.1);
    }

    function isSkinYIQ(r, g, b) {
        const rn = r / 255;
        const gn = g / 255;
        const bn = b / 255;

        const y = 0.299 * rn + 0.587 * gn + 0.114 * bn;
        const i = 0.596 * rn - 0.274 * gn - 0.322 * bn;
        const q = 0.211 * rn - 0.523 * gn + 0.312 * bn;

        // Scale I and Q to -128 to 127 range common in literature
        // Skin typically has I > 0 and Q is very small
        return (i > 0.05 && i < 0.25) && (q > -0.1 && q < 0.1);
    }

    function isSkinHSV(r, g, b) {
        let rn = r / 255;
        let gn = g / 255;
        let bn = b / 255;

        let max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
        let h, s, v = max;
        let d = max - min;
        s = max === 0 ? 0 : d / max;

        if (max === min) {
            h = 0;
        } else {
            switch (max) {
                case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break;
                case gn: h = (bn - rn) / d + 2; break;
                case bn: h = (rn - gn) / d + 4; break;
            }
            h /= 6;
        }

        const hDeg = h * 360;
        // Typical skin range in HSV
        return (hDeg >= 0 && hDeg <= 35) && (s >= 0.2 && s <= 0.68) && (v >= 0.35);
    }

    function isSkinYCbCr(r, g, b) {
        const y = 16 + (65.481 * r / 256) + (128.553 * g / 256) + (24.966 * b / 256);
        const cb = 128 - (37.797 * r / 256) - (74.203 * g / 256) + (112.0 * b / 256);
        const cr = 128 + (112.0 * r / 256) - (93.786 * g / 256) - (18.214 * b / 256);

        // Standard skin detection thresholds in YCbCr
        return (y > 80) && (cb > 77 && cb < 127) && (cr > 133 && cr < 173);
    }

    function updateStats(stats) {
        document.getElementById('stats-log').textContent = `Pixels detected: ${stats.log.toLocaleString()}`;
        document.getElementById('stats-yiq').textContent = `Pixels detected: ${stats.yiq.toLocaleString()}`;
        document.getElementById('stats-hsv').textContent = `Pixels detected: ${stats.hsv.toLocaleString()}`;
        document.getElementById('stats-ycbcr').textContent = `Pixels detected: ${stats.ycbcr.toLocaleString()}`;
    }

    function updateChart(stats) {
        const ctx = document.getElementById('comparison-chart').getContext('2d');

        const data = {
            labels: ['Log Opponent', 'YIQ', 'HSV', 'YCbCr'],
            datasets: [{
                label: 'Skin Pixels Count',
                data: [stats.log, stats.yiq, stats.hsv, stats.ycbcr],
                backgroundColor: [
                    'rgba(99, 102, 241, 0.6)',
                    'rgba(16, 185, 129, 0.6)',
                    'rgba(245, 158, 11, 0.6)',
                    'rgba(239, 68, 68, 0.6)'
                ],
                borderColor: [
                    '#6366f1',
                    '#10b981',
                    '#f59e0b',
                    '#ef4444'
                ],
                borderWidth: 2
            }]
        };

        if (comparisonChart) {
            comparisonChart.destroy();
        }

        comparisonChart = new Chart(ctx, {
            type: 'bar',
            data: data,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(255, 255, 255, 0.1)' },
                        ticks: { color: '#94a3b8' }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#94a3b8' }
                    }
                }
            }
        });
    }

    function recommendAlgorithm(stats) {
        // YCbCr is generally considered the robust standard for skin detection 
        // because it decouples luminance (Y) from chrominance (Cb, Cr) effectively.
        // We'll pick based on the one that detected a "reasonable" amount but prioritize YCbCr or HSV

        let best = 'YCbCr';
        let reason = "The YCbCr algorithm is recommended as it effectively separates luminance from chrominance, making it highly robust to varying lighting conditions which is common in skin detection.";

        // If HSV detected more pixels and YCbCr seems too conservative
        if (stats.hsv > stats.ycbcr * 1.5 && stats.hsv > 0) {
            best = 'HSV';
            reason = "The HSV algorithm captured more skin features in this specific image. It is excellent for handling shadows but can be sensitive to skin-colored backgrounds.";
        } else if (stats.ycbcr === 0 && stats.log > 0) {
            best = 'Log Opponent';
            reason = "Log Opponent was the only one that found significant matches, suggesting non-linear lighting conditions.";
        }

        recommendationText.textContent = best;
        recommendationReason.textContent = reason;
    }
});
