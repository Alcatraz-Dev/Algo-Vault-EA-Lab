const p = require('./package.json');
console.log('motion dep present:', !!p.dependencies?.motion);
console.log('react-bits present:', !!p.dependencies?.['react-bits']);
console.log('lucide:', !!p.dependencies?.['lucide-react']);
console.log('recharts:', !!p.dependencies?.recharts);
console.log('@xyflow:', !!p.dependencies?.['@xyflow/react']);
