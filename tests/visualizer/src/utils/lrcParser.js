export function parseLRC(lrcContent) {
    const lines = lrcContent.split('\n');
    const lrcLines = [];
    const timeRegex = /^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)$/;
    for (const line of lines) {
        const match = line.match(timeRegex);
        if (match) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            const milliseconds = parseInt(match[3].padEnd(3, '0'), 10);
            const timestamp = minutes * 60 + seconds + milliseconds / 1000;
            const text = match[4].trim();
            if (text) {
                lrcLines.push({ timestamp, text });
            }
        }
    }
    lrcLines.sort((a, b) => a.timestamp - b.timestamp);
    for (let i = 0; i < lrcLines.length - 1; i++) {
        lrcLines[i].endTime = lrcLines[i + 1].timestamp;
    }
    if (lrcLines.length > 0) {
        const lastLine = lrcLines[lrcLines.length - 1];
        lastLine.endTime = lastLine.timestamp + 5;
    }
    return lrcLines;
}
export function formatTimestamp(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}
