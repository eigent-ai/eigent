import './ShinyText.css';

interface ShinyTextProps {
    text: string;
    disabled?: boolean;
    speed?: number;
    className?: string; 
}

const ShinyText: React.FC<ShinyTextProps> = ({ text, disabled = false, speed = 3, className = '' }) => {
    const animationDuration = `${speed}s`;

    return (
        <div
            className={`shiny-text ${disabled ? 'disabled' : ''} ${className}`}
            style={{ animationDuration }}
        >
            {text}
        </div>
    );
};

export default ShinyText;