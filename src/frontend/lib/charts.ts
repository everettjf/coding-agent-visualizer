// Register only the Chart.js pieces we use (keeps the bundle lean — avoids
// chart.js/auto) and share dark-theme defaults across every chart.
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Filler,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Filler,
  Tooltip,
  Legend,
);

ChartJS.defaults.color = "#8a92a6";
ChartJS.defaults.font.family =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
ChartJS.defaults.borderColor = "rgba(255,255,255,0.06)";

export { ChartJS };
