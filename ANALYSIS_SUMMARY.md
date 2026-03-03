# AI Model Performance Analysis Summary

**Analysis Date**: 2025-11-28
**Data Source**: `/Users/puzhen/Desktop/extracted_browser_logs`

---

## Executive Summary

Comprehensive analysis of 3 AI models (claude-opus-4-5, gemini-3-pro-preview, gpt-5.1) across 45 tasks, measuring task success rates, criteria success rates, and tool calling patterns.

---

## Key Findings

### 1. Overall Performance Rankings

| Rank | Model | Task Success | Criteria Success | Avg Tool Calls |
|:----:|:------|-------------:|-----------------:|---------------:|
| 🥇 | claude-opus-4-5 | **80.00%** | **80.00%** | 32.38 |
| 🥈 | gemini-3-pro-preview | **73.33%** | **75.00%** | 22.14 |
| 🥉 | gpt-5.1 | **66.67%** | **70.00%** | 17.67 |

### 2. Tool Calling Behavior: Success vs Failure

**Critical Discovery**: Different models exhibit opposite behaviors when failing:

| Model | Success Tasks | Failure Tasks | Difference | Pattern |
|:------|-------------:|-------------:|:----------:|:--------|
| claude-opus-4-5 | 15.11 | **57.33** | +42.22 | 🔄 Tries harder when failing |
| gemini-3-pro-preview | 21.09 | **44.25** | +23.16 | 🔄 Tries harder when failing |
| gpt-5.1 | **22.50** | 19.40 | -3.10 | ❌ Gives up earlier when failing |

**Interpretation**:
- **Claude & Gemini**: When facing difficult tasks, they make MORE attempts before failing (persistence strategy)
- **GPT-5.1**: When failing, it uses FEWER tool calls, suggesting early termination (efficiency over persistence)

### 3. Efficiency Analysis

**Tool Calls per Successful Task**:
1. claude-opus-4-5: 15.11 steps (most efficient)
2. gemini-3-pro-preview: 21.09 steps
3. gpt-5.1: 22.50 steps (least efficient)

**Insight**: Claude Opus achieves highest success rate with fewest steps on successful tasks, indicating superior task-solving efficiency.

---

## Detailed Statistics

### claude-opus-4-5

```
Total Tasks: 15
Success: 12 (80.00%)
Failure: 3 (20.00%)

Tool Calling Breakdown:
├─ Average (all tasks): 32.38
├─ Successful tasks: 15.11 (9 tasks)
│  └─ Range: 2-27 steps
└─ Failed tasks: 57.33 (3 tasks)
   └─ Range: 36-76 steps

API Calls: 41.19 average
```

**Success Pattern**: Efficient execution on achievable tasks
**Failure Pattern**: Extensive attempts before giving up (up to 76 tool calls)

### gemini-3-pro-preview

```
Total Tasks: 15
Success: 11 (73.33%)
Failure: 4 (26.67%)

Tool Calling Breakdown:
├─ Average (all tasks): 22.14
├─ Successful tasks: 21.09 (11 tasks)
│  └─ Range: 10-42 steps
└─ Failed tasks: 44.25 (4 tasks)
   └─ Range: 13-78 steps

API Calls: 31.29 average
```

**Success Pattern**: Moderate step count with consistent execution
**Failure Pattern**: Significantly more attempts when struggling

### gpt-5.1

```
Total Tasks: 15
Success: 10 (66.67%)
Failure: 5 (33.33%)

Tool Calling Breakdown:
├─ Average (all tasks): 17.67
├─ Successful tasks: 22.50 (10 tasks)
│  └─ Range: 7-48 steps
└─ Failed tasks: 19.40 (5 tasks)
   └─ Range: 10-27 steps

API Calls: 25.48 average
```

**Success Pattern**: Requires more steps to achieve success
**Failure Pattern**: Gives up relatively quickly (fewer attempts)

---

## Browser Log Error Analysis

### Search Results

**Total Operations Analyzed**: 2,556 across 63 task directories

**Error Search Patterns**:
- "error" keyword: 0 occurrences
- "not found" keyword: 0 occurrences
- "failed" keyword: 0 occurrences
- "timeout" keyword: 0 occurrences
- "exception" keyword: 0 occurrences

**Output Field Analysis**:
- Operations with `success: false`: 0
- Operations with explicit error messages: 0

### Conclusion

Browser logs do NOT contain explicit error messages. Task failures occur through:
1. **Gradual degradation**: Actions succeed but don't achieve goals
2. **Early termination**: Models stop attempting (especially GPT-5.1)
3. **Persistent failure**: Models continue trying without success (especially Claude/Gemini)

---

## Strategic Insights

### 1. Model Selection Guidelines

**For High-Stakes Tasks (must succeed)**:
- **Recommend**: claude-opus-4-5 (80% success, most efficient)
- **Alternative**: gemini-3-pro-preview (73% success, balanced)

**For Cost-Sensitive Tasks**:
- **Recommend**: gpt-5.1 (lowest API calls: 25.48 avg)
- **Tradeoff**: Lower success rate (66.67%)

**For Complex/Uncertain Tasks**:
- **Recommend**: gemini-3-pro-preview (persistent but not excessive)
- **Avoid**: claude-opus-4-5 (may waste resources trying)

### 2. Task Difficulty Impact

Refer to `TASK_DIFFICULTY_ANALYSIS.md` for detailed breakdown by task complexity:
- **Simple tasks (≤12 steps)**: All models perform well
- **Medium tasks (13-24 steps)**: Claude Opus and Gemini preferred
- **Complex tasks (≥25 steps)**: Gemini performs best; Claude Opus fails completely

### 3. Failure Mode Understanding

**Claude-Opus-4-5**: "All-or-nothing" strategy
- Succeeds efficiently (15 steps) or fails after exhaustive attempts (57 steps)
- Risk: Resource waste on impossible tasks

**Gemini-3-Pro-Preview**: "Persistent balanced" strategy
- Moderate attempts on both success (21) and failure (44)
- Risk: May over-invest in difficult tasks

**GPT-5.1**: "Fast failure" strategy
- Similar steps for success (22.5) and failure (19.4)
- Risk: May give up too early on solvable tasks

---

## Data Quality Notes

### Coverage
- **Total tasks analyzed**: 45 (15 per model)
- **Users**: 5 (Tao sun, pengcheng, puzhen, saed, waleed)
- **Data sources**:
  - action.log (36 tasks)
  - debug.log (9 tasks)
  - camel_logs (tool calling data)
  - browser_logs (action sequences)

### Special Mappings
- Last 3 claude-opus-4-5 tasks: saed/claude_opus_4-5_{1,2,3}
- Debug.log tasks: puzhen directory
- Failed GPT-5.1 task: puzhen/06_gpt-5.1

---

## Files Generated

1. `tool_calling_analysis.json` - Raw tool calling statistics
2. `evaluation_matched_results.json` - Matched evaluation data
3. `final_comprehensive_report.json` - Comprehensive metrics
4. `TASK_DIFFICULTY_ANALYSIS.md` - Task difficulty breakdown
5. `ANALYSIS_SUMMARY.md` - This document

---

## Methodology

### Tool Calling Count
```python
# From camel_logs/*.json files
if 'response' in data and 'choices' in data['response']:
    for choice in data['response']['choices']:
        if 'message' in choice and 'tool_calls' in choice['message']:
            return len(tool_calls)
```

### Model Name Normalization
- gpt-5.1 variants → `gpt-5.1`
- gemini-3-pro-preview variants → `gemini-3-pro-preview`
- claude-opus-4-5 variants → `claude-opus-4-5`
- claude-sonnet-4-5 variants → `claude-sonnet-4-5` (excluded from final analysis)

### Success/Failure Matching
```python
# Match by user/task_num
task_key = f"{user}/{task_num}"
# Use model_in_dir for camel_logs lookup
# Use eval_model for result grouping
```

---

## Limitations

1. **Sample Size**: 15 tasks per model may not capture all edge cases
2. **Task Distribution**: Tasks may not be uniformly difficult across models
3. **Error Granularity**: Browser logs don't capture semantic errors (only success/failure)
4. **Context Missing**: Cannot determine WHY certain tasks failed from logs alone

---

## Recommendations for Future Work

1. **Adaptive Model Selection**: Implement task complexity estimation to route to appropriate model
2. **Timeout Policies**: Set step limits based on model behavior (lower for Claude, moderate for others)
3. **Hybrid Approaches**: Start with GPT-5.1, escalate to Claude/Gemini on failure
4. **Error Instrumentation**: Add semantic error logging to browser action framework
5. **Task Difficulty Prediction**: Train classifier to predict minimum required steps

---

**Generated by**: Analysis pipeline
**Source Code**: `analyze_tool_calling_steps.py`, `generate_final_report.py`, `match_logs_with_evaluation.py`
