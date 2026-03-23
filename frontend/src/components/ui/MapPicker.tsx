import { useState, useEffect, useRef } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { MapPin, Search, X, Navigation } from 'lucide-react';
import { calculateDistance } from '../../lib/geo';
export { calculateDistance } from '../../lib/geo';

// Jakarta default coordinates
const DEFAULT_CENTER: [number, number] = [-6.2088, 106.8456];

export interface Location {
  lat: number;
  lng: number;
  name: string;
}

interface MapPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (location: Location) => void;
  title?: string;
  initialLocation?: Location | null;
}

// Nominatim search result interface
interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type: string;
  class: string;
}

export function MapPicker({ 
  isOpen, 
  onClose, 
  onSelect, 
  title = "Select Location",
  initialLocation 
}: MapPickerProps) {
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(initialLocation || null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [mapCenter, setMapCenter] = useState<[number, number]>(
    initialLocation ? [initialLocation.lat, initialLocation.lng] : DEFAULT_CENTER
  );
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dynamically import Leaflet only when modal is open
  useEffect(() => {
    if (!isOpen || !mapRef.current) return;

    let isMounted = true;

    const initMap = async () => {
      const L = await import('leaflet');
      await import('leaflet/dist/leaflet.css');

      if (!isMounted || !mapRef.current) return;

      // Fix Leaflet default markers
      // @ts-expect-error: Leaflet types don't include _getIconUrl
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: (await import('leaflet/dist/images/marker-icon-2x.png')).default,
        iconUrl: (await import('leaflet/dist/images/marker-icon.png')).default,
        shadowUrl: (await import('leaflet/dist/images/marker-shadow.png')).default,
      });

      // Create map
      const map = L.map(mapRef.current).setView(mapCenter, 13);
      mapInstanceRef.current = map;

      // Add tile layer
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);

      // Handle map clicks
      map.on('click', (e: L.LeafletMouseEvent) => {
        const { lat, lng } = e.latlng;
        handleMapClick(lat, lng);
      });

      // Add initial marker if exists
      if (selectedLocation) {
        const marker = L.marker([selectedLocation.lat, selectedLocation.lng])
          .addTo(map)
          .bindPopup(selectedLocation.name);
        markerRef.current = marker;
      }
    };

    initMap();

    return () => {
      isMounted = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markerRef.current = null;
      }
    };
  }, [isOpen]);

  // Update marker when location changes
  useEffect(() => {
    if (!mapInstanceRef.current || !selectedLocation) return;

    const updateMarker = async () => {
      const L = await import('leaflet');
      
      // Remove existing marker
      if (markerRef.current) {
        markerRef.current.remove();
      }

      // Add new marker
      const marker = L.marker([selectedLocation.lat, selectedLocation.lng])
        .addTo(mapInstanceRef.current!)
        .bindPopup(selectedLocation.name)
        .openPopup();
      markerRef.current = marker;

      // Pan to location
      mapInstanceRef.current!.panTo([selectedLocation.lat, selectedLocation.lng]);
    };

    updateMarker();
  }, [selectedLocation]);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (searchQuery.trim().length < 3) {
      setSearchResults([]);
      return;
    }

    searchTimeoutRef.current = setTimeout(() => {
      performSearch(searchQuery);
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  const performSearch = async (query: string) => {
    if (!query.trim()) return;
    
    setIsSearching(true);
    try {
      // Limit to Indonesia (countrycodes=id)
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=id&limit=5`
      );
      const data: NominatimResult[] = await response.json();
      setSearchResults(data);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleMapClick = async (lat: number, lng: number) => {
    // Reverse geocode to get location name
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`
      );
      const data = await response.json();
      const locationName = data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      
      setSelectedLocation({
        lat,
        lng,
        name: locationName,
      });
    } catch {
      // If reverse geocoding fails, just use coordinates
      setSelectedLocation({
        lat,
        lng,
        name: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      });
    }
  };

  const handleSelectResult = (result: NominatimResult) => {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    
    setSelectedLocation({
      lat,
      lng,
      name: result.display_name,
    });
    setMapCenter([lat, lng]);
    setSearchResults([]);
    setSearchQuery('');

    // Pan map to new location
    if (mapInstanceRef.current) {
      mapInstanceRef.current.panTo([lat, lng]);
    }
  };

  const handleConfirm = () => {
    if (selectedLocation) {
      onSelect(selectedLocation);
      onClose();
    }
  };

  // Format location name for display (truncate if too long)
  const formatLocationName = (name: string) => {
    if (name.length > 60) {
      return name.substring(0, 60) + '...';
    }
    return name;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      subtitle="Click on the map or search for a location"
      size="xl"
    >
      <div className="space-y-4">
        {/* Search Box */}
        <div className="relative z-20">
          <div className="flex items-center gap-2 bg-[var(--ref-surface-container-low)] rounded-xl px-3 py-2">
            <Search className="w-4 h-4 text-[var(--color-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search location (e.g., Mall Kota Kasablanka, Jakarta)"
              className="flex-1 bg-transparent border-none outline-none text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSearchResults([]);
                }}
                className="cursor-pointer p-1 hover:bg-[var(--ref-surface-container-highest)] rounded-full"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--ref-surface-container-lowest)] rounded-xl border border-[var(--color-border)] shadow-lg max-h-48 overflow-y-auto z-50">
              {searchResults.map((result) => (
                <button
                  key={result.place_id}
                  onClick={() => handleSelectResult(result)}
                  className="cursor-pointer w-full text-left px-3 py-2 hover:bg-[var(--ref-surface-container-low)] border-b border-[var(--color-border)] last:border-b-0 text-sm"
                >
                  <div className="truncate">{result.display_name}</div>
                </button>
              ))}
            </div>
          )}

          {isSearching && (
            <div className="absolute top-full left-0 right-0 mt-1 text-center py-2 text-sm text-[var(--color-muted)]">
              Searching...
            </div>
          )}
        </div>

        {/* Map */}
        <div 
          ref={mapRef}
          className="h-64 sm:h-80 rounded-xl overflow-hidden border border-[var(--color-border)] relative z-0"
        />

        {/* Selected Location Display */}
        {selectedLocation && (
          <div className="bg-[var(--ref-surface-container-low)] rounded-xl p-3">
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 text-[var(--color-accent)] mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
                  Selected Location
                </p>
                <p className="text-sm mt-1">{formatLocationName(selectedLocation.name)}</p>
                <p className="text-xs text-[var(--color-muted)] mt-0.5">
                  {selectedLocation.lat.toFixed(6)}, {selectedLocation.lng.toFixed(6)}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end pt-2">
          <Button type="button" variant="secondary" onClick={onClose} className="rounded-full py-2">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={!selectedLocation}
            className="rounded-full py-2 shadow-lg"
          >
            <Navigation className="w-4 h-4 mr-1.5" />
            Confirm Location
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Component to display transport route summary
interface TransportLocation {
  lat: number;
  lng: number;
  name: string;
}

interface TransportRouteProps {
  origin: TransportLocation | null;
  destination: TransportLocation | null;
  onEditOrigin: () => void;
  onEditDestination: () => void;
}

export function TransportRoute({
  origin,
  destination,
  onEditOrigin,
  onEditDestination,
}: TransportRouteProps) {
  const distance = origin && destination
    ? calculateDistance(origin.lat, origin.lng, destination.lat, destination.lng)
    : null;

  return (
    <div className="bg-[var(--ref-surface-container-low)] rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
        <Navigation className="w-3.5 h-3.5" />
        Route
      </div>

      {/* Origin */}
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-[var(--color-accent)]/10 flex items-center justify-center shrink-0">
          <MapPin className="w-4 h-4 text-[var(--color-accent)]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-[var(--color-muted)]">From</p>
          {origin ? (
            <>
              <p className="text-sm font-medium truncate">{origin.name}</p>
              <button
                onClick={onEditOrigin}
                className="cursor-pointer text-xs text-[var(--color-accent)] hover:underline mt-0.5"
              >
                Change
              </button>
            </>
          ) : (
            <button
              onClick={onEditOrigin}
              className="cursor-pointer text-sm text-[var(--color-accent)] hover:underline"
            >
              Set origin
            </button>
          )}
        </div>
      </div>

      {/* Connecting line */}
      <div className="flex items-center gap-3 pl-4">
        <div className="w-0.5 h-6 bg-[var(--color-border)] ml-3.5" />
        {distance && (
          <span className="text-xs text-[var(--color-muted)]">
            {distance.toFixed(1)} km
          </span>
        )}
      </div>

      {/* Destination */}
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-[var(--ref-error)]/10 flex items-center justify-center shrink-0">
          <MapPin className="w-4 h-4 text-[var(--ref-error)]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-[var(--color-muted)]">To</p>
          {destination ? (
            <>
              <p className="text-sm font-medium truncate">{destination.name}</p>
              <button
                onClick={onEditDestination}
                className="cursor-pointer text-xs text-[var(--color-accent)] hover:underline mt-0.5"
              >
                Change
              </button>
            </>
          ) : (
            <button
              onClick={onEditDestination}
              className="cursor-pointer text-sm text-[var(--color-accent)] hover:underline"
            >
              Set destination
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default MapPicker;
