import { useState, useEffect, useCallback } from "react";
import { Button } from "../ui/button";
import { MdCheck, MdRefresh } from "react-icons/md";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Card } from "../ui/card";
import styles from "./SourceSelector.module.css";

interface DesktopSource {
  id: string;
  name: string;
  thumbnail: string | null;
  display_id: string;
  appIcon: string | null;
}

export function SourceSelector() {
  const [sources, setSources] = useState<DesktopSource[]>([]);
  const [selectedSource, setSelectedSource] = useState<DesktopSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [screenPermission, setScreenPermission] = useState<string>('granted');

  const fetchSources = useCallback(async () => {
    setLoading(true);
    try {
      // Always call getSources() first — on macOS this triggers the permission prompt
      // which adds the app to System Settings > Screen Recording
      const rawSources = await window.electronAPI.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true
      });

      if (rawSources.length > 0) {
        setScreenPermission('granted');
        setSources(
          rawSources.map(source => ({
            id: source.id,
            name:
              source.id.startsWith('window:') && source.name.includes(' — ')
                ? source.name.split(' — ')[1] || source.name
                : source.name,
            thumbnail: source.thumbnail,
            display_id: source.display_id,
            appIcon: source.appIcon
          }))
        );
      } else {
        // desktopCapturer blocked (macOS 15+/26) — fall back to electron.screen displays
        const displays = await window.electronAPI.getDisplays();
        if (displays.length > 0) {
          setScreenPermission('granted');
          setSources(displays);
        } else if (window.electronAPI.getScreenPermissionStatus) {
          const status = await window.electronAPI.getScreenPermissionStatus();
          setScreenPermission(status);
        }
      }
    } catch (error) {
      console.error('Error loading sources:', error);
      // desktopCapturer blocked — try electron.screen fallback
      try {
        const displays = await window.electronAPI.getDisplays();
        if (displays.length > 0) {
          setScreenPermission('granted');
          setSources(displays);
          return;
        }
      } catch {}
      if (window.electronAPI.getScreenPermissionStatus) {
        const status = await window.electronAPI.getScreenPermissionStatus();
        setScreenPermission(status);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  const screenSources = sources.filter(s => s.id.startsWith('screen:'));
  const windowSources = sources.filter(s => s.id.startsWith('window:'));

  const handleSourceSelect = (source: DesktopSource) => setSelectedSource(source);
  const handleShare = async () => {
    if (selectedSource) await window.electronAPI.selectSource(selectedSource);
  };

  if (loading) {
    return (
      <div className={`h-full flex items-center justify-center ${styles.glassContainer}`} style={{ minHeight: '100vh' }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-zinc-600 mx-auto mb-2" />
          <p className="text-xs text-zinc-300">Loading sources...</p>
        </div>
      </div>
    );
  }

  // macOS screen recording permission not granted
  if (screenPermission !== 'granted') {
    const isDenied = screenPermission === 'denied' || screenPermission === 'restricted';
    return (
      <div className={`min-h-screen flex flex-col items-center justify-center ${styles.glassContainer}`}>
        <div className="flex flex-col items-center gap-3 px-8 text-center max-w-sm">
          <div className="text-3xl">🔒</div>
          <p className="text-sm font-medium text-zinc-200">Screen Recording Permission Required</p>
          <p className="text-xs text-zinc-400">
            {isDenied
              ? 'Screen Recording was denied. Open System Settings, find Electron (or Lumirec) in the list and enable it, then relaunch the app.'
              : 'Go to System Settings → Privacy & Security → Screen Recording and enable Electron (or Lumirec), then click "Check again".'}
          </p>
          <Button
            className="text-xs px-4 py-1"
            onClick={async () => {
              await window.electronAPI.openScreenRecordingSettings?.();
            }}
          >
            Open System Settings
          </Button>
          <button
            className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1 mt-1"
            onClick={fetchSources}
          >
            <MdRefresh className="w-3 h-3" /> Check again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen flex flex-col items-center justify-center ${styles.glassContainer}`}>
      <div className="flex-1 flex flex-col w-full max-w-xl" style={{ padding: 0 }}>
        <Tabs defaultValue="screens">
          <TabsList className="grid grid-cols-2 mb-3 bg-zinc-900/40 rounded-full">
            <TabsTrigger value="screens" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-foreground/70 rounded-full text-xs py-1">Screens</TabsTrigger>
            <TabsTrigger value="windows" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-foreground/70 rounded-full text-xs py-1">Windows</TabsTrigger>
          </TabsList>
            <div className="h-72 flex flex-col justify-stretch">
            <TabsContent value="screens" className="h-full">
              <div className="grid grid-cols-2 gap-2 h-full overflow-y-auto pr-1 relative">
                {screenSources.length === 0 && (
                  <div className="col-span-2 flex flex-col items-center justify-center h-full gap-2 text-zinc-500">
                    <p className="text-xs">No screens found</p>
                    <button className="text-xs flex items-center gap-1 hover:text-zinc-300" onClick={fetchSources}>
                      <MdRefresh className="w-3 h-3" /> Refresh
                    </button>
                  </div>
                )}
                {screenSources.map(source => (
                  <Card
                    key={source.id}
                    className={`${styles.sourceCard} ${selectedSource?.id === source.id ? styles.selected : ''} cursor-pointer h-fit p-2 scale-95`}
                    style={{ margin: 8, width: '90%', maxWidth: 220 }}
                    onClick={() => handleSourceSelect(source)}
                  >
                    <div className="p-1">
                      <div className="relative mb-1">
                        <img
                          src={source.thumbnail || ''}
                          alt={source.name}
                          className="w-full aspect-video object-cover rounded border border-zinc-800"
                        />
                        {selectedSource?.id === source.id && (
                          <div className="absolute -top-1 -right-1">
                            <div className="w-4 h-4 bg-primary rounded-full flex items-center justify-center shadow-md">
                              <MdCheck className={styles.icon} />
                            </div>
                          </div>
                        )}
                      </div>
                      <div className={styles.name + " truncate"}>{source.name}</div>
                    </div>
                  </Card>
                ))}
              </div>
            </TabsContent>
            <TabsContent value="windows" className="h-full">
              <div className="grid grid-cols-2 gap-2 h-full overflow-y-auto pr-1 relative">
                {windowSources.length === 0 && (
                  <div className="col-span-2 flex flex-col items-center justify-center h-full gap-2 text-zinc-500">
                    <p className="text-xs">No windows found</p>
                    <button className="text-xs flex items-center gap-1 hover:text-zinc-300" onClick={fetchSources}>
                      <MdRefresh className="w-3 h-3" /> Refresh
                    </button>
                  </div>
                )}
                {windowSources.map(source => (
                  <Card
                    key={source.id}
                    className={`${styles.sourceCard} ${selectedSource?.id === source.id ? styles.selected : ''} cursor-pointer h-fit p-2 scale-95`}
                    style={{ margin: 8, width: '90%', maxWidth: 220 }}
                    onClick={() => handleSourceSelect(source)}
                  >
                    <div className="p-1">
                      <div className="relative mb-1">
                        <img
                          src={source.thumbnail || ''}
                          alt={source.name}
                          className="w-full aspect-video object-cover rounded border border-gray-700"
                        />
                        {selectedSource?.id === source.id && (
                          <div className="absolute -top-1 -right-1">
                            <div className="w-4 h-4 bg-primary rounded-full flex items-center justify-center shadow-md">
                              <MdCheck className={styles.icon} />
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {source.appIcon && (
                          <img
                            src={source.appIcon}
                            alt="App icon"
                            className={styles.icon + " flex-shrink-0"}
                          />
                        )}
                        <div className={styles.name + " truncate"}>{source.name}</div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </div>
      <div className="border-t border-zinc-800 p-2 w-full max-w-xl">
        <div className="flex justify-center gap-2">
          <Button variant="outline" onClick={() => window.close()} className="px-4 py-1 text-xs">Cancel</Button>
          <Button onClick={handleShare} disabled={!selectedSource} className="px-4 py-1 text-xs">Share</Button>
        </div>
      </div>
    </div>
  );
}
