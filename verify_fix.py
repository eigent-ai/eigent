# ========= Copyright 2023-2024 @ CAMEL-AI.org. All Rights Reserved. =========
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# ========= Copyright 2023-2024 @ CAMEL-AI.org. All Rights Reserved. =========

import argparse
import base64
import json
import os
from pathlib import Path

from openai import OpenAI
from PIL import Image


class Step7ReasoningCorrectnessValidator:
    """
    Step 7: Validate correctness of the reasoning process (FINAL STEP).

    Uses Gemini 3 Pro Preview to validate:
    1. Is the reasoning process logically correct?
    2. Are there any errors in the reasoning?
    3. Does the reasoning make unjustified assumptions?
    4. Does the reasoning only use information given in the question/image?

    Only items passing ALL checks are saved to final_results.
    """

    def __init__(self, config, subject: str = "mechanical engineering"):
        """
        Initialize the validator.

        Args:
            config: Configuration dictionary.
            subject: The subject/discipline for the prompt (e.g., "mechanical engineering", "physics").
        """
        self.config = config
        self.model_config = config['models']['gemini_reasoning']
        self.subject = subject

    def _create_client(self) -> OpenAI:
        """
        Create a fresh OpenAI client for Gemini.

        Returns:
            Fresh OpenAI client instance.
        """
        return OpenAI(
            api_key=self.model_config['api_key'],
            base_url=self.model_config['base_url'],
        )

    def _encode_image(self, image_path: str) -> str:
        """
        Encode image to base64 string.

        Args:
            image_path: Path to the image file.

        Returns:
            Base64 encoded image string with data URI prefix.
        """
        with Image.open(image_path) as img:
            # Convert to RGB if necessary
            if img.mode != 'RGB':
                img = img.convert('RGB')

            # Save to bytes
            import io
            img_byte_arr = io.BytesIO()
            img.save(img_byte_arr, format='JPEG')
            img_byte_arr = img_byte_arr.getvalue()

            # Encode to base64 with data URI
            base64_str = base64.b64encode(img_byte_arr).decode('utf-8')
            return f"data:image/jpeg;base64,{base64_str}"

    def validate(self, match_result: dict) -> dict:
        """
        Validate the correctness of the reasoning process.

        Args:
            match_result: Dictionary from Step 5 answer match validation.

        Returns:
            Dictionary with correctness validation results.
        """
        # Create fresh client for this validation
        client = self._create_client()

        # Encode image
        image_data_uri = self._encode_image(match_result['image_path'])

        # Correctness validation prompt
        prompt = f"""You are an expert {self.subject} educator. Please carefully review the following reasoning process and validate its correctness.

**Question:** {match_result['question']}

**Reasoning Process:**
{match_result['reasoning']}

**Final Answer:** {match_result['ground_truth_answer']}

Please evaluate the reasoning process and image quality based on these criteria:

**Reasoning Validation:**

1. **is_reasoning_correct**: Is the reasoning process logically correct and follows proper {self.subject} principles?

2. **has_no_errors**: Are there any factual errors, miscalculations, or incorrect applications of formulas/principles?

3. **makes_no_assumptions**: Does the reasoning make any unjustified assumptions that are not given in the question or visible in the image?

4. **uses_only_given_info**: Does the reasoning only use information provided in the question and image, without introducing external knowledge or data not presented?

**Image Quality Validation:**

5. **image_matches_question**: Does the image content match and correspond to the question being asked?

6. **image_contains_only_relevant_content**: Does the image contain ONLY the content relevant to this specific question, without any other unrelated problems or extra content?

7. **image_is_clear**: Is the image clear, legible, and of sufficient quality to be properly understood and analyzed?

**Answer Extraction:**

8. **final_value**: Extract the final numerical/text result from the Final Answer above. Include the unit if applicable. For example: "1.344", "25 N/m²", "Option A", etc.

Respond with ONLY a JSON object in this exact format:
{{
  "is_reasoning_correct": {{
    "value": true or false,
    "explanation": "Brief explanation"
  }},
  "has_no_errors": {{
    "value": true or false,
    "explanation": "Brief explanation of any errors found, or confirmation of no errors"
  }},
  "makes_no_assumptions": {{
    "value": true or false,
    "explanation": "Brief explanation of any unjustified assumptions, or confirmation of none"
  }},
  "uses_only_given_info": {{
    "value": true or false,
    "explanation": "Brief explanation"
  }},
  "image_matches_question": {{
    "value": true or false,
    "explanation": "Brief explanation of whether the image matches the question"
  }},
  "image_contains_only_relevant_content": {{
    "value": true or false,
    "explanation": "Brief explanation of whether the image contains only relevant content without extra problems"
  }},
  "image_is_clear": {{
    "value": true or false,
    "explanation": "Brief explanation of the image clarity and legibility"
  }},
  "final_value": "The extracted final result with unit"
}}"""

        # Create message with image
        response = client.chat.completions.create(
            model=self.model_config['model_name'],
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": prompt
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": image_data_uri
                            }
                        }
                    ]
                }
            ],
            temperature=self.model_config['temperature'],
        )

        # Parse response
        response_text = response.choices[0].message.content.strip()

        # Extract JSON
        if '```json' in response_text:
            json_start = response_text.find('```json') + 7
            json_end = response_text.find('```', json_start)
            response_text = response_text[json_start:json_end].strip()
        elif '```' in response_text:
            json_start = response_text.find('```') + 3
            json_end = response_text.find('```', json_start)
            response_text = response_text[json_start:json_end].strip()

        correctness_result = json.loads(response_text)

        # Check if all correctness checks passed (reasoning + image quality)
        all_passed = (
            correctness_result['is_reasoning_correct']['value'] and
            correctness_result['has_no_errors']['value'] and
            correctness_result['makes_no_assumptions']['value'] and
            correctness_result['uses_only_given_info']['value'] and
            correctness_result['image_matches_question']['value'] and
            correctness_result['image_contains_only_relevant_content']['value'] and
            correctness_result['image_is_clear']['value']
        )

        # Extract final_value from correctness_result
        final_value = correctness_result.get('final_value', '')

        # Build result
        result = {
            'index': match_result['index'],
            'image_name': match_result['image_name'],
            'image_path': match_result['image_path'],
            'question': match_result['question'],
            'ground_truth_answer': match_result['ground_truth_answer'],
            'reasoning': match_result['reasoning'],
            'final_value': final_value,
            'correctness_validation': correctness_result,
            'all_correctness_checks_passed': all_passed,
        }

        return result

    def save_result(self, result: dict, output_dir: str, rejected_dir: str, final_dir: str) -> None:
        """
        Save validation result to appropriate directory.

        Args:
            result: Validation result dictionary.
            output_dir: Directory for all Step 6 validations.
            rejected_dir: Directory for failed correctness checks.
            final_dir: Directory for final validated results (ONLY for passed items).
        """
        index = result['index']
        filename = f"{index}_{result['image_name'].replace('.', '_')}.json"

        # Always save to output_dir
        output_path = Path(output_dir) / filename
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False)

        # If failed, also save to rejected_dir
        if not result['all_correctness_checks_passed']:
            rejected_path = Path(rejected_dir) / filename
            with open(rejected_path, 'w', encoding='utf-8') as f:
                json.dump(result, f, indent=2, ensure_ascii=False)
        else:
            # If passed, save to final_results with essential fields only
            final_result = {
                'index': result['index'],
                'question': result['question'],
                'image_name': result['image_name'],
                'reasoning': result['reasoning'],
                'ground_truth_answer': result['ground_truth_answer'],
                'final_value': result['final_value'],
            }

            final_path = Path(final_dir) / filename
            with open(final_path, 'w', encoding='utf-8') as f:
                json.dump(final_result, f, indent=2, ensure_ascii=False)


def load_jsonl(jsonl_path: str, image_dir: str) -> list:
    """
    Load JSONL file and convert to match_result format.

    Args:
        jsonl_path: Path to the JSONL file.
        image_dir: Directory containing the images.

    Returns:
        List of match_result dictionaries.
    """
    results = []
    with open(jsonl_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            data = json.loads(line)
            match_result = {
                'image_path': os.path.join(image_dir, data['image_file']),
                'image_name': data['image_file'],
                'question': data['question'],
                'reasoning': data['reasoning'],
                'ground_truth_answer': data['final_answer'],
                'index': data['index'],
            }
            results.append(match_result)
    return results


def main():
    parser = argparse.ArgumentParser(description='Validate reasoning correctness from JSONL file.')
    parser.add_argument('--jsonl', required=True, help='Path to input JSONL file')
    parser.add_argument('--image_dir', required=True, help='Directory containing images')
    parser.add_argument('--output_dir', default='./output', help='Directory for all validation results')
    parser.add_argument('--rejected_dir', default='./rejected', help='Directory for failed validations')
    parser.add_argument('--final_dir', default='./final', help='Directory for final passed results')
    parser.add_argument('--subject', default='mechanical engineering', help='Subject/discipline for the prompt')
    parser.add_argument('--api_key', required=True, help='API key for Gemini')
    parser.add_argument('--base_url', default='https://generativelanguage.googleapis.com/v1beta/openai/', help='Base URL for API')
    parser.add_argument('--model_name', default='gemini-2.5-pro-preview-05-06', help='Model name')
    parser.add_argument('--temperature', type=float, default=0.0, help='Temperature for generation')

    args = parser.parse_args()

    # Create config
    config = {
        'models': {
            'gemini_reasoning': {
                'api_key': args.api_key,
                'base_url': args.base_url,
                'model_name': args.model_name,
                'temperature': args.temperature,
            }
        }
    }

    # Create output directories
    Path(args.output_dir).mkdir(parents=True, exist_ok=True)
    Path(args.rejected_dir).mkdir(parents=True, exist_ok=True)
    Path(args.final_dir).mkdir(parents=True, exist_ok=True)

    # Initialize validator
    validator = Step7ReasoningCorrectnessValidator(config, subject=args.subject)

    # Load JSONL
    match_results = load_jsonl(args.jsonl, args.image_dir)
    print(f"Loaded {len(match_results)} items from {args.jsonl}")

    # Process each item
    for i, match_result in enumerate(match_results):
        print(f"Processing {i+1}/{len(match_results)}: {match_result['image_name']}")
        try:
            result = validator.validate(match_result)
            validator.save_result(result, args.output_dir, args.rejected_dir, args.final_dir)
            status = "PASSED" if result['all_correctness_checks_passed'] else "FAILED"
            print(f"  -> {status}, final_value: {result.get('final_value', 'N/A')}")
        except Exception as e:
            print(f"  -> ERROR: {e}")

    print("Done!")


if __name__ == '__main__':
    main()