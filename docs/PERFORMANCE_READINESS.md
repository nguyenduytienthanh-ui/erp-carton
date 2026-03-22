# Performance Readiness

This note captures the minimum rehearsal steps for large-data command centers before go-live.

## 1. Run the baseline

```powershell
cd backend
python manage.py performance_readiness --json
```

The report highlights datasets that are already above rehearsal thresholds and points to the most sensitive screens.

Capture a deeper drilldown for the flagged surfaces:

```powershell
python manage.py performance_drilldown --json
```

Use `--include-all` when you want a full rehearsal packet:

```powershell
python manage.py performance_drilldown --include-all --json
```

## 2. Priority surfaces

Review these areas first when row counts grow:
- `ExecutiveCockpit`
- `ReportsCenter`
- `WorkflowAnalyticsDashboard`
- task inbox and workflow history
- audit center and notifications

## 3. Rehearsal checklist

- test pagination and filter latency with production-like data
- confirm debounce and query refetch behavior on fast typing
- review database indexes for heavily filtered status/date columns
- capture slow query findings using `DB_SLOW_QUERY_THRESHOLD_MS`
- attach the drilldown JSON to the release packet for any warning surface
- rerun targeted regression after any index or query changes

## 4. Exit criteria

- no critical dataset remains unreviewed
- slow-query threshold is defined for production
- staging/UAT users confirm large lists and dashboards remain usable
