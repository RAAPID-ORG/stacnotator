import Overlay from "ol/Overlay";
import type OLMap from "ol/Map";

export interface CrosshairOverlayController {
  overlay: Overlay;
  updatePosition: (map: OLMap) => void;
  setColor: (color: string) => void;
  setVisible: (visible: boolean) => void;
}

const buildSvg = (color: string) => `
  <svg width="20" height="20" xmlns="http://www.w3.org/2000/svg">
    <line x1="0" y1="10" x2="20" y2="10" stroke="#${color}" stroke-width="1.5"/>
    <line x1="10" y1="0" x2="10" y2="20" stroke="#${color}" stroke-width="1.5"/>
  </svg>
`;

export const createCrosshairOverlay = (initialColor = "ffffff"): CrosshairOverlayController => {
  const element = document.createElement("div");
  element.style.pointerEvents = "none";
  element.style.display = "block";
  element.innerHTML = buildSvg(initialColor);

  const overlay = new Overlay({
    element,
    positioning: "center-center",
    stopEvent: false,
  });

  const updatePosition = (map: OLMap) => {
    overlay.setPosition(map.getView().getCenter());
  };

  const setColor = (color: string) => {
    element.innerHTML = buildSvg(color);
  };

  const setVisible = (visible: boolean) => {
    element.style.display = visible ? "block" : "none";
  };

  return {
    overlay,
    updatePosition,
    setColor,
    setVisible,
  };
};