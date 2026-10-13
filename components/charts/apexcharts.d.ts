declare module 'apexcharts' {
  export interface ApexOptions { [key: string]: any }
}
declare module 'react-apexcharts' {
  import { Component } from 'react';
  export default class ReactApexChart extends Component<any, any> {}
}
