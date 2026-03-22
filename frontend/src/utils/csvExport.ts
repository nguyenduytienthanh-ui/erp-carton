export function downloadCSV<T extends object>(data: T[], filename: string) {
  if (!data || data.length === 0) {
    return;
  }

  const headers = Object.keys(data[0] as Record<string, unknown>);
  const csvContent = [
    headers.map((h) => `"${h}"`).join(','),
    ...data.map((row) =>
      headers
        .map((h) => {
          const value = (row as Record<string, unknown>)[h];
          if (value === null || value === undefined) return '""';
          const strValue = String(value).replace(/"/g, '""');
          return `"${strValue}"`;
        })
        .join(',')
    ),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}_${new Date().getTime()}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
