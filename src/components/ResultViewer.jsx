// src/components/ResultViewer.jsx
export default function ResultViewer({ result }) {
  if (!result) return null;

  return (
    <pre className="bg-light mt-3 p-2 small rounded text-break">
      {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
    </pre>
  );
}
