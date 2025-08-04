import { LRCLine, LyricsChunk } from '../../src/types';
import { parseLRC } from '../../src/utils/lrcParser';
import { chunkLyrics } from '../../src/utils/textChunker';

// Display constants matching smart glasses
const MAX_LINES = 5;
const MAX_CHARS = 45;

interface DisplayLayout {
    lines: Array<{
        text: string;
        type: 'header' | 'divider' | 'current' | 'preview' | 'info';
    }>;
}

class KaraokeVisualizer {
    private currentSong: string = 'clint-eastwood';
    private displayMode: string = 'lyrics-focused';
    private chunkingMode: string = 'simple';
    private timeOffset: number = 0;
    private currentTime: number = 0;
    private duration: number = 0;
    private isPlaying: boolean = false;
    private animationFrame?: number;
    
    private lrcData: LRCLine[] = [];
    private chunks: LyricsChunk[] = [];
    private improvedChunks: LyricsChunk[] = [];
    
    constructor() {
        this.initializeControls();
        this.loadSong();
    }
    
    private initializeControls(): void {
        // Song selection
        const songSelect = document.getElementById('songSelect') as HTMLSelectElement;
        songSelect.addEventListener('change', () => {
            this.currentSong = songSelect.value;
            this.loadSong();
        });
        
        // Display mode
        const displayMode = document.getElementById('displayMode') as HTMLSelectElement;
        displayMode.addEventListener('change', () => {
            this.displayMode = displayMode.value;
            this.updateDisplay();
        });
        
        // Chunking mode
        const chunkingMode = document.getElementById('chunkingMode') as HTMLSelectElement;
        chunkingMode.addEventListener('change', () => {
            this.chunkingMode = chunkingMode.value;
            this.processLyrics();
        });
        
        // Time offset
        const timeOffset = document.getElementById('timeOffset') as HTMLInputElement;
        const offsetValue = document.getElementById('offsetValue') as HTMLSpanElement;
        timeOffset.addEventListener('input', () => {
            this.timeOffset = parseFloat(timeOffset.value);
            offsetValue.textContent = this.timeOffset.toString();
            this.updateDisplay();
        });
        
        // Playback controls
        document.getElementById('playBtn')?.addEventListener('click', () => this.play());
        document.getElementById('pauseBtn')?.addEventListener('click', () => this.pause());
        document.getElementById('resetBtn')?.addEventListener('click', () => this.reset());
    }
    
    private async loadSong(): Promise<void> {
        try {
            const response = await fetch(`../fixtures/songs/${this.currentSong}.lrc`);
            const lrcContent = await response.text();
            this.lrcData = parseLRC(lrcContent);
            this.duration = this.calculateDuration();
            this.processLyrics();
            this.reset();
        } catch (error) {
            console.error('Failed to load song:', error);
        }
    }
    
    private calculateDuration(): number {
        if (this.lrcData.length === 0) return 0;
        const lastLine = this.lrcData[this.lrcData.length - 1];
        return lastLine.endTime || lastLine.timestamp + 5;
    }
    
    private processLyrics(): void {
        // Simple chunking
        this.chunks = chunkLyrics(this.lrcData, 8, MAX_CHARS, 2);
        
        // Improved chunking based on mode
        switch (this.chunkingMode) {
            case 'smart':
                this.improvedChunks = this.smartChunkLyrics();
                break;
            case 'timing':
                this.improvedChunks = this.timingBasedChunking();
                break;
            default:
                this.improvedChunks = this.chunks;
        }
        
        this.updateStats();
        this.updateTimeline();
        this.updateDisplay();
    }
    
    private smartChunkLyrics(): LyricsChunk[] {
        const chunks: LyricsChunk[] = [];
        let i = 0;
        
        while (i < this.lrcData.length) {
            const currentLine = this.lrcData[i];
            const nextLine = this.lrcData[i + 1];
            
            // Check if lines should be merged
            if (nextLine && this.shouldMergeLines(currentLine, nextLine)) {
                // Merge two lines
                chunks.push({
                    lines: [currentLine.text, nextLine.text],
                    startTime: currentLine.timestamp,
                    endTime: nextLine.endTime || nextLine.timestamp + 2,
                    wordsPerLine: [
                        currentLine.text.split(' ').length,
                        nextLine.text.split(' ').length
                    ]
                });
                i += 2;
            } else {
                // Single line chunk
                chunks.push({
                    lines: [currentLine.text],
                    startTime: currentLine.timestamp,
                    endTime: currentLine.endTime || currentLine.timestamp + 2,
                    wordsPerLine: [currentLine.text.split(' ').length]
                });
                i++;
            }
        }
        
        return chunks;
    }
    
    private shouldMergeLines(line1: LRCLine, line2: LRCLine): boolean {
        // Don't merge if either line is too long
        if (line1.text.length > MAX_CHARS || line2.text.length > MAX_CHARS) {
            return false;
        }
        
        // Merge if timing is close (within 2 seconds)
        const timeDiff = line2.timestamp - (line1.endTime || line1.timestamp);
        if (timeDiff < 2) {
            return true;
        }
        
        // Merge if first line ends without punctuation (incomplete thought)
        const lastChar = line1.text.trim().slice(-1);
        if (!['.', '!', '?'].includes(lastChar)) {
            return true;
        }
        
        return false;
    }
    
    private timingBasedChunking(): LyricsChunk[] {
        // Group lines that are close together in time
        const chunks: LyricsChunk[] = [];
        let currentChunk: LRCLine[] = [];
        let chunkStartTime = 0;
        
        for (let i = 0; i < this.lrcData.length; i++) {
            const line = this.lrcData[i];
            const prevLine = this.lrcData[i - 1];
            
            if (currentChunk.length === 0) {
                currentChunk.push(line);
                chunkStartTime = line.timestamp;
            } else {
                const timeSinceLast = line.timestamp - (prevLine?.endTime || prevLine?.timestamp || 0);
                
                if (timeSinceLast < 1.5 && currentChunk.length < 2) {
                    currentChunk.push(line);
                } else {
                    // Finalize current chunk
                    chunks.push(this.createChunkFromLines(currentChunk, chunkStartTime));
                    currentChunk = [line];
                    chunkStartTime = line.timestamp;
                }
            }
        }
        
        if (currentChunk.length > 0) {
            chunks.push(this.createChunkFromLines(currentChunk, chunkStartTime));
        }
        
        return chunks;
    }
    
    private createChunkFromLines(lines: LRCLine[], startTime: number): LyricsChunk {
        const lastLine = lines[lines.length - 1];
        return {
            lines: lines.map(l => l.text),
            startTime,
            endTime: lastLine.endTime || lastLine.timestamp + 2,
            wordsPerLine: lines.map(l => l.text.split(' ').length)
        };
    }
    
    private updateDisplay(): void {
        const adjustedTime = this.currentTime + this.timeOffset;
        
        // Update current display
        const currentLayout = this.getDisplayLayout(adjustedTime, this.chunks);
        this.renderDisplay('currentDisplay', currentLayout);
        
        // Update improved display
        const improvedLayout = this.getDisplayLayout(adjustedTime, this.improvedChunks);
        this.renderDisplay('improvedDisplay', improvedLayout);
        
        // Update time display
        const currentTimeStr = this.formatTime(this.currentTime);
        const durationStr = this.formatTime(this.duration);
        const timeDisplay = document.getElementById('currentTime');
        if (timeDisplay) {
            timeDisplay.textContent = `${currentTimeStr} / ${durationStr}`;
        }
    }
    
    private getDisplayLayout(time: number, chunks: LyricsChunk[]): DisplayLayout {
        const layout: DisplayLayout = { lines: [] };
        
        // Find current chunk
        const currentChunk = chunks.find(c => time >= c.startTime && time < c.endTime);
        const currentIndex = currentChunk ? chunks.indexOf(currentChunk) : -1;
        
        switch (this.displayMode) {
            case 'lyrics-focused':
                if (currentChunk) {
                    // Add current lyrics
                    currentChunk.lines.forEach(line => {
                        layout.lines.push({ text: line, type: 'current' });
                    });
                    
                    // Add separator if room
                    if (layout.lines.length < MAX_LINES - 2) {
                        layout.lines.push({ text: '─────', type: 'divider' });
                    }
                    
                    // Add next preview if room
                    const nextChunk = chunks[currentIndex + 1];
                    if (nextChunk && layout.lines.length < MAX_LINES - 1) {
                        layout.lines.push({ 
                            text: nextChunk.lines[0].substring(0, MAX_CHARS - 3) + '...', 
                            type: 'preview' 
                        });
                    }
                    
                    // Add time at bottom
                    layout.lines.push({ 
                        text: `${this.formatTime(time)} / ${this.formatTime(this.duration)}`, 
                        type: 'info' 
                    });
                } else {
                    this.addSongInfoLayout(layout, time);
                }
                break;
                
            case 'with-context':
                // Compact header
                layout.lines.push({ 
                    text: `♪ ${this.formatTime(time)} / ${this.formatTime(this.duration)}`, 
                    type: 'header' 
                });
                
                // Previous line (if exists)
                const prevChunk = currentIndex > 0 ? chunks[currentIndex - 1] : null;
                if (prevChunk) {
                    const lastLine = prevChunk.lines[prevChunk.lines.length - 1];
                    layout.lines.push({ 
                        text: '··· ' + lastLine.substring(0, MAX_CHARS - 8) + ' ···', 
                        type: 'preview' 
                    });
                }
                
                // Current lines
                if (currentChunk) {
                    currentChunk.lines.forEach(line => {
                        layout.lines.push({ text: '> ' + line, type: 'current' });
                    });
                }
                
                // Next preview
                const nextChunk = chunks[currentIndex + 1];
                if (nextChunk && layout.lines.length < MAX_LINES) {
                    layout.lines.push({ 
                        text: '··· ' + nextChunk.lines[0].substring(0, MAX_CHARS - 8) + ' ···', 
                        type: 'preview' 
                    });
                }
                break;
                
            case 'minimal':
                if (currentChunk) {
                    currentChunk.lines.forEach(line => {
                        layout.lines.push({ text: line, type: 'current' });
                    });
                    
                    // Fill remaining space
                    while (layout.lines.length < MAX_LINES - 1) {
                        layout.lines.push({ text: '', type: 'current' });
                    }
                    
                    layout.lines.push({ 
                        text: `${this.formatTime(time)} / ${this.formatTime(this.duration)}`, 
                        type: 'info' 
                    });
                } else {
                    this.addSongInfoLayout(layout, time);
                }
                break;
                
            case 'song-info':
                this.addSongInfoLayout(layout, time);
                break;
        }
        
        // Ensure we don't exceed MAX_LINES
        layout.lines = layout.lines.slice(0, MAX_LINES);
        
        return layout;
    }
    
    private addSongInfoLayout(layout: DisplayLayout, time: number): void {
        const songTitles: { [key: string]: { title: string; artist: string; album?: string } } = {
            'clint-eastwood': { title: 'Clint Eastwood', artist: 'Gorillaz', album: 'Gorillaz' },
            'hey-ya': { title: 'Hey Ya!', artist: 'OutKast', album: 'The Love Below' },
            'bohemian-rhapsody': { title: 'Bohemian Rhapsody', artist: 'Queen', album: 'A Night at the Opera' }
        };
        
        const info = songTitles[this.currentSong];
        layout.lines.push({ text: `♪ ${info.title}`, type: 'header' });
        layout.lines.push({ text: `  ${info.artist}`, type: 'header' });
        if (info.album) {
            layout.lines.push({ text: `  ${info.album}`, type: 'info' });
        }
        layout.lines.push({ text: '', type: 'info' });
        layout.lines.push({ 
            text: `  ${this.formatTime(time)} / ${this.formatTime(this.duration)}`, 
            type: 'info' 
        });
    }
    
    private renderDisplay(displayId: string, layout: DisplayLayout): void {
        const display = document.getElementById(displayId);
        if (!display) return;
        
        const content = display.querySelector('.display-content');
        if (!content) return;
        
        content.innerHTML = '';
        
        layout.lines.forEach((line, index) => {
            const lineDiv = document.createElement('div');
            lineDiv.className = `display-line ${line.type}`;
            lineDiv.textContent = line.text;
            
            // Add character counter
            const counter = document.createElement('span');
            counter.className = 'char-counter';
            if (line.text.length > MAX_CHARS) {
                counter.classList.add('overflow');
            }
            counter.textContent = `${line.text.length}/${MAX_CHARS}`;
            lineDiv.appendChild(counter);
            
            content.appendChild(lineDiv);
        });
        
        // Fill empty lines
        for (let i = layout.lines.length; i < MAX_LINES; i++) {
            const emptyLine = document.createElement('div');
            emptyLine.className = 'display-line';
            emptyLine.innerHTML = '&nbsp;';
            content.appendChild(emptyLine);
        }
    }
    
    private updateStats(): void {
        // Calculate statistics for improved chunks
        const chunks = this.improvedChunks;
        
        let totalWords = 0;
        let totalChars = 0;
        let totalLines = 0;
        
        chunks.forEach(chunk => {
            chunk.lines.forEach((line, idx) => {
                totalWords += chunk.wordsPerLine[idx];
                totalChars += line.length;
                totalLines++;
            });
        });
        
        const avgWords = chunks.length > 0 ? (totalWords / chunks.length).toFixed(1) : '0';
        const avgChars = totalLines > 0 ? (totalChars / totalLines).toFixed(1) : '0';
        const avgLines = chunks.length > 0 ? (totalLines / chunks.length).toFixed(1) : '0';
        
        document.getElementById('avgWords')!.textContent = avgWords;
        document.getElementById('avgChars')!.textContent = avgChars;
        document.getElementById('avgLines')!.textContent = avgLines;
        document.getElementById('totalChunks')!.textContent = chunks.length.toString();
    }
    
    private updateTimeline(): void {
        const markersContainer = document.getElementById('timelineMarkers');
        if (!markersContainer) return;
        
        markersContainer.innerHTML = '';
        
        // Add markers for each chunk
        this.improvedChunks.forEach(chunk => {
            const marker = document.createElement('div');
            marker.className = 'timeline-marker';
            marker.style.left = `${(chunk.startTime / this.duration) * 100}%`;
            markersContainer.appendChild(marker);
        });
    }
    
    private formatTime(seconds: number): string {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    private play(): void {
        this.isPlaying = true;
        this.animate();
    }
    
    private pause(): void {
        this.isPlaying = false;
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }
    }
    
    private reset(): void {
        this.pause();
        this.currentTime = 0;
        this.updateDisplay();
        this.updateTimelineProgress();
    }
    
    private animate(): void {
        if (!this.isPlaying) return;
        
        this.currentTime += 0.1; // Increment by 100ms
        
        if (this.currentTime > this.duration) {
            this.reset();
            return;
        }
        
        this.updateDisplay();
        this.updateTimelineProgress();
        
        this.animationFrame = requestAnimationFrame(() => {
            setTimeout(() => this.animate(), 100);
        });
    }
    
    private updateTimelineProgress(): void {
        const progress = document.getElementById('timelineProgress') as HTMLDivElement;
        if (progress) {
            progress.style.width = `${(this.currentTime / this.duration) * 100}%`;
        }
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new KaraokeVisualizer());
} else {
    new KaraokeVisualizer();
}