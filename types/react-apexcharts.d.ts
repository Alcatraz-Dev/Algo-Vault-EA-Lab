declare module "react-apexcharts" {
  import { ComponentType } from "react";
  interface ApexChartProps {
    type?: string;
    series?: any;
    options?: any;
    height?: string | number;
    [key: string]: any;
  }
  const Chart: ComponentType<ApexChartProps>;
  export default Chart;
}
