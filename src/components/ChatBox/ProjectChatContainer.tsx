import React, { useRef, useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ProjectSection } from './ProjectSection';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';

interface ProjectChatContainerProps {
  className?: string;
  onPauseResume: () => void;
  onSkip: () => void;
  isPauseResumeLoading: boolean;
}

export const ProjectChatContainer: React.FC<ProjectChatContainerProps> = ({ 
  className = "",
  onPauseResume,
  onSkip,
  isPauseResumeLoading
}) => {
  const { projectStore, chatStore } = useChatStoreAdapter();
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [activeQueryId, setActiveQueryId] = useState<string | null>(null);
  const [lastMessageCount, setLastMessageCount] = useState(0);

  // Get all chat stores for the active project
  const activeProjectId = projectStore.activeProjectId;
  const chatStores = activeProjectId 
    ? projectStore.getAllChatStores(activeProjectId)
    : [];

  // Scroll to bottom function
  const scrollToBottom = useCallback(() => {
    if (containerRef.current) {
      setTimeout(() => {
        containerRef.current!.scrollTo({
          top: containerRef.current!.scrollHeight,
          behavior: "smooth",
        });
      }, 100);
    }
  }, []);

  // Monitor for new user messages and auto-scroll
  useEffect(() => {
    if (!chatStore || !activeProjectId) return;

    const activeTaskId = chatStore.activeTaskId;
    if (!activeTaskId) return;

    const task = chatStore.tasks[activeTaskId];
    if (!task) return;

    const currentMessageCount = task.messages.length;
    
    // Check if a new user message was added
    if (currentMessageCount > lastMessageCount) {
      const lastMessage = task.messages[task.messages.length - 1];
      
      // If the last message is from user, scroll to bottom
      if (lastMessage && lastMessage.role === 'user') {
        scrollToBottom();
      }
    }
    
    setLastMessageCount(currentMessageCount);
  }, [chatStore?.tasks[chatStore.activeTaskId as string]?.messages, lastMessageCount, scrollToBottom, activeProjectId]);

  // Reset message count when active task changes
  useEffect(() => {
    setLastMessageCount(0);
  }, [chatStore?.activeTaskId]);

  // Intersection Observer for scroll-based animations
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const queryId = entry.target.getAttribute('data-query-id');
            if (queryId) {
              setActiveQueryId(queryId);
            }
          }
        });
      },
      {
        root: containerRef.current,
        rootMargin: '-20% 0px -60% 0px', // Trigger when query is in upper portion
        threshold: 0.1
      }
    );

    // Observe all query groups
    const queryGroups = containerRef.current.querySelectorAll('[data-query-id]');
    queryGroups.forEach((group) => observer.observe(group));

    return () => {
      queryGroups.forEach((group) => observer.unobserve(group));
    };
  }, [chatStores]);

  // Handle scrollbar visibility on scroll
  useEffect(() => {
    const scrollContainer = containerRef.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      // Add scrolling class
      scrollContainer.classList.add('scrolling');

      // Clear existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      // Remove scrolling class after 1 second of no scrolling
      scrollTimeoutRef.current = setTimeout(() => {
        scrollContainer.classList.remove('scrolling');
      }, 1000);
    };

    scrollContainer.addEventListener('scroll', handleScroll);

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div 
      ref={containerRef}
      className={`flex-1 relative z-10 flex flex-col overflow-y-auto scrollbar gap-2 ${className}`}
    >
      <AnimatePresence mode="popLayout">
        {chatStores.map(({ chatId, chatStore }) => {
          const chatState = chatStore.getState();
          const activeTaskId = chatState.activeTaskId;
          
          if (!activeTaskId || !chatState.tasks[activeTaskId]) {
            return null;
          }

          const task = chatState.tasks[activeTaskId];
          const hasMessages = task.messages.length > 0 || task.hasMessages;

          if (!hasMessages) {
            return null;
          }

          return (
            <ProjectSection
              key={chatId}
              chatId={chatId}
              chatStore={chatStore}
              activeQueryId={activeQueryId}
              onQueryActive={setActiveQueryId}
              onPauseResume={onPauseResume}
              onSkip={onSkip}
              isPauseResumeLoading={isPauseResumeLoading}
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
};
